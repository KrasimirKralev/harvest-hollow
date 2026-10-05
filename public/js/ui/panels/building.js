// A production building (GDD §3.3 Feed Mill, §3.5 workshops, §3.4 rule 8 Compost Bin): the queue as slot cards
// (finished goods wait in the tray, the running one ticks, queued ones can be cancelled), slot upgrades, Hurry,
// and every recipe with inputs have/need, time, value, XP, mastery stars and the "Try it" ribbon. Duet recipes
// offer "Cook together" (both press within 3 s) and the solo slow-cook. Opened with args { id } (Smart Hand on a
// building, the Basket's long-press, a tracker card); args.focus = a recipe id scrolls to that recipe and rings it
// ("Show me" on a recipe unlock, the partner's Duet banner).
import { itemOf, classMembers, BOOSTS, COOP } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, fmtDuration, createKit, chip, hintable, stars, ribbonTag, pill, empty, bar, fill, playerMark } from './kit.js';
import { buildingView, hurryAcorns, hurryQuote, levelOf, durationText, skipText, quietText, noFeedText, unkeepText } from './model.js';
import { has, probe } from './core.js';
import { I, actUndoable } from './intents.js';
import { waitingOf, keyed, moveKey, reorderIntent, finishIntent, finishQuote, FINISH_RULE, useIntent, usedToday } from './w4b-rules.js';
import { touchPlayer } from '../dom.js';

const lazy = (f) => ({ type: () => f().type, args: () => f().args });
/** A touch player (a touch last, or a coarse pointer): the ◀ ▶ of a waiting card show when it is tapped, not on hover. */
const touchUi = (controller) => touchPlayer(controller);
const CLASS_LABEL = { grain: 'any grain', root: 'any root crop', produce: 'any crop or fruit' };
/** The reason text of a feed's RESERVED (only members worth too much are left; Make asks first). */
const FEED_ASKS = Object.freeze({ RESERVED: 'Asks first: what is left is worth a lot' });

export const buildingPanel = {
  title: (args, state) => {
    const o = state && Object.hasOwn(state.farm.objects, args.id) ? state.farm.objects[args.id] : null;
    const v = o ? buildingView(state, args.id, 0) : null;
    return v ? v.name : 'Workshop';
  },
  icon: null,
  size: 'wide',
  // noFeed: the Feed Mill's "not for feed" lines change with the Barn switch (and its Allow button here)
  topics: ['objects', 'inventory', 'wallet', 'xp', 'mastery', 'joint', 'keep', 'noFeed', 'stats'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const id = ctx.args.id;
    const toast = (text, o) => ctx.ui?.toast?.(text, o);     // the Undo line of a feed / keep change
    const head = h('div.pn-bhead');
    const slots = h('div.pn-slots', { role: 'list', 'aria-label': 'Queue' });
    const duet = h('div.pn-duetbox', { 'aria-live': 'polite' });
    const recipes = h('div.pn-recipes', { role: 'list' });
    const later = h('div.pn-later-row');
    body.append(head, slots, duet, recipes, later);
    const view = () => buildingView(ctx.store.state, id, ctx.now());
    const hurryLabels = [];
    let duetT = 0;
    // wave 4b (owner wish 5): the waiting items can be dragged to a new place (a finger holds first), or moved a step
    // with ◀ ▶; each shows what finishing it now costs. A re-render waits while a card is being dragged.
    let picked = null;           // the waiting item's key whose ◀ ▶ show on a touch screen (tap to pick)
    let held = false;
    let dragging = false;
    const qtip = h('p.pn-queue-tip', { hidden: true });
    slots.after(qtip);
    // the drag code loads with the first workshop panel (the boot never carries it)
    let qdrag = null;
    let gone = false;
    import('./queue-drag.js').then((m) => {
      if (gone) return;
      qdrag = m.attachQueueDrag(slots, {
        selector: '.pn-slot.queued[data-k]',
        keyOf: (el) => Number(el.dataset.k),
        onDrop: (k, to) => reorderTo(k, to),
        onState: (on) => { dragging = on; if (!on && held) { held = false; update(true); } },
      });
    }).catch((err) => console.error('queue drag did not load', err));

    const sig = () => {
      const v = view();
      if (!v) return null;
      return [v.queue.map((q) => [q.r, q.s, q.e, q.status, q.by, q.duet, q.slow]), v.slots, v.nextCost,
        v.recipes.map((r) => [r.id, r.locked, r.inputs.map((x) => [x.have, x.need, x.skipped]), r.stars, r.tryIt, r.ms, r.skips]),
        v.collector, v.duet && [v.duet.by, v.duet.at, v.duet.recipe], levelOf(ctx.store.state)];
    };
    const update = kit.memo(body, sig, render);

    function render() {
      if (dragging) { held = true; return; }
      const v = view();
      if (!v) {
        head.replaceChildren();
        slots.replaceChildren(empty("This building isn't on the farm any more.", 'hammer'));
        duet.replaceChildren(); recipes.replaceChildren(); later.replaceChildren();
        return;
      }
      ctx.setTitle(v.name);
      renderHead(v);
      renderSlots(v);
      renderDuet(v);
      renderRecipes(v);
      kit.refresh();
      kit.tick();
    }

    function renderHead(v) {
      const h2 = headLines(v, ctx.now());
      const collect = v.tray > 0 || (v.collector && v.collector.batches > 0)
        ? kit.button({ label: v.collector ? `Empty the bin (${fmt(v.collector.batches * v.collector.out)})` : `Collect ${fmt(v.trayUnits)}`,
          glyph: 'check', cls: 'btn--sun pn-collect', ...lazy(() => I.collectTray(id)), data: { collect: id } })
        : null;
      fill(head, h('div.pn-bhead-art', icon(v.def.id, { size: 72 })),
        h('div.pn-bhead-text',
          h('p.pn-bhead-status', h2.ready.length
            ? h2.ready.map((r) => h('span.pn-ready', icon(r.item, { size: 28 }), `${r.name} ready: ${fmt(r.n)}`))
            : h2.status),
          h2.sub ? h('p.pn-bhead-sub', h2.sub) : null),
        collect, turnerButton(v));
    }

    function renderSlots(v) {
      slots.replaceChildren();
      hurryLabels.length = 0;
      if (v.collector) {
        const c = v.collector;
        slots.append(h('div.pn-collector', bar(c.points / c.every, `${fmt(c.points)} / ${fmt(c.every)}`, 'pn-go'),
          h('div.pn-collector-batches', ...Array.from({ length: c.max }, (_, i) => h(`span.pn-batch${i < c.batches ? '.full' : ''}`,
            icon(c.item, { size: 40 }), h('small', `×${c.out}`))))));
        return;
      }
      const wait = waitingOf(v.obj, ctx.now());
      const order = wait.length > 1 && keyed(wait) ? wait.map((x) => x.k) : null;
      const canOrder = Boolean(order && reorderIntent(ctx.store, id, order));
      if (picked !== null && !(order && order.includes(picked))) picked = null;
      for (const q of v.queue) slots.append(slotCard(v, q, canOrder ? order : null));
      slots.classList.toggle('pn-orderable', canOrder);
      qtip.hidden = !canOrder;
      qtip.textContent = touchUi(ctx.controller) ? 'Hold a waiting item and drag it to a new place, or tap it for ◀ ▶.'
        : 'Drag a waiting item to change what is made next.';
      for (let i = v.queue.length; i < v.slots; i++) {
        slots.append(h('div.pn-slot.empty', { role: 'listitem' }, h('span.pn-slot-plus', '+'), h('small', 'Empty slot')));
      }
      if (v.nextCost !== null) {
        slots.append(h('div.pn-slot.buy', { role: 'listitem' },
          h('small', `Slot ${v.slots + 1} of ${v.max}`),
          kit.button({ label: fmt(v.nextCost), glyph: 'coin', cls: 'pn-xs btn--sky', ...lazy(() => I.addSlot(id)), data: { addslot: id },
            hint: () => ({ coins: Math.max(0, v.nextCost - ctx.store.state.farm.wallet.coins) }) })));
      }
    }

    /** The Time Turner (wave 4b relic), once a farm day: every queue on the farm finishes now. Only while it can. */
    function turnerButton(v) {
      const st = ctx.store.state;
      const it = useIntent('time_turner');
      if (!it || !st.farm.relics?.time_turner || usedToday(st, 'time_turner', ctx.now()) || !v.queue.some((q) => q.status !== 'done')) return null;
      return kit.button({ label: 'Time Turner', glyph: 'star', cls: 'pn-sm btn--sky pn-turner', type: () => it.type, args: () => it.args,
        data: { relicUse: 'time_turner' }, title: 'Once a day: every workshop queue on the farm finishes now' });
    }

    /** Put waiting item `k` at place `to` among the waiting items (the rules re-time them; predicted, the partner sees it). */
    function reorderTo(k, to) {
      const wait = waitingOf(ctx.store.state.farm.objects[id], ctx.now());
      const keys = wait.map((x) => x.k);
      const next = moveKey(keys, k, to);
      if (next.every((x, i) => x === keys[i])) return;
      const it = reorderIntent(ctx.store, id, next);
      if (!it) return;
      const r = ctx.act(it.type, it.args);
      if (r && r.ok === false && r.code === 'NOT_FOUND') ctx.ui.toast('That one already started or was collected.', { kind: 'info' });
      update(true);
    }

    /** ◀ ▶ under a waiting card: one step sooner / later. */
    function moveRow(q, order, name) {
      const at = order.indexOf(q.k);
      const step = (d, glyph, label) => h(`button.pn-move-btn`, { type: 'button', dataset: { move: String(d), key: `move-${q.k}-${d}` },
        disabled: (d < 0 && at <= 0) || (d > 0 && at >= order.length - 1), title: `${label} ${name}`, 'aria-label': `${label} ${name}`,
        on: { click: (e) => { e.stopPropagation(); reorderTo(q.k, at + d); } } }, glyph);
      return h('div.pn-slot-move', step(-1, '◀', 'Make sooner:'), step(1, '▶', 'Make later:'));
    }

    /** The Acorn price that finishes this one item now (wish 5): the running one's Hurry, a waiting one's own price. */
    function finishButton(q, name) {
      const st = ctx.store.state;
      if (levelOf(st) < BOOSTS.hurry.unlock) return null;
      const it = finishIntent(ctx.store, id, q);
      if (!it) return null;
      const cur = () => ctx.store.state.farm.objects[id]?.queue?.find((x) => x.k === q.k) ?? q;
      const cost = () => finishQuote(ctx.store, id, cur(), ctx.now())?.acorns ?? 0;
      const btn = kit.button({ label: `${cost()}`, glyph: 'acorn', cls: 'pn-xs btn--sun pn-hurry pn-finish',
        title: `Finish ${name} now: ${cost()} Acorn${cost() === 1 ? '' : 's'}. ${FINISH_RULE}`,
        type: () => it.type, args: () => it.args, data: { finish: String(q.k) },
        hint: () => ({ acorns: Math.max(0, cost() - ctx.store.state.farm.wallet.acorns) }) });
      btn.button.setAttribute('aria-label', `Finish ${name} now for ${cost()} Acorn${cost() === 1 ? '' : 's'}`);
      hurryLabels.push({ el: btn.button.querySelector('.pn-btn-label'), q, finish: true });
      return btn;
    }

    function slotCard(v, q, order = null) {
      const r = q.recipe;
      const name = r ? r.name : q.item;
      const st = ctx.store.state;
      const el = h(`div.pn-slot.${q.status}${q.duet ? '.duet' : ''}`, { role: 'listitem', dataset: { slot: String(q.i) },
        title: `${name}${q.by ? ` · queued by ${st.players[q.by]?.name ?? q.by}` : ''}` },
      icon(q.item, { size: 48 }), q.out > 1 ? h('span.pn-slot-out', `×${q.out}`) : null,
      q.by && st.players[q.by] ? h('span.pn-slot-by', playerMark(q.by, st.players[q.by], { title: `Queued by ${st.players[q.by].name}` })) : null);
      if (q.status === 'done') {
        el.append(h('span.pn-slot-state', 'Ready!'), h('span.pn-sparkle', { 'aria-hidden': 'true' }));
      } else if (q.status === 'running') {
        const fill = bar(0, null, 'pn-thin pn-sky');
        el.append(fill, kit.timer(h('span.pn-slot-state.pn-timer'), { end: q.e, start: q.s, bar: fill, done: () => update(true) }));
        if (q.duet || q.slow) {
          el.append(h('span.pn-slot-tags', q.duet ? ribbonTag('Together', 'pn-try') : null,
            q.slow ? ribbonTag('Slow-cook', 'pn-season') : null));
        }
        if (levelOf(st) >= BOOSTS.hurry.unlock) {
          const cost = () => hurryQuote(ctx.store.state, id, ctx.now())?.acorns ?? hurryAcorns(q.e - ctx.now());
          const hurry = kit.button({ label: `${cost()}`, glyph: 'acorn', cls: 'pn-xs btn--sun pn-hurry',
            title: 'Hurry: finish it now (1 Acorn per started hour)', ...lazy(() => I.hurry(id)), data: { hurry: id },
            hint: () => ({ acorns: Math.max(0, cost() - ctx.store.state.farm.wallet.acorns) }) });
          el.append(hurry);
          hurryLabels.push({ el: hurry.button.querySelector('.pn-btn-label'), end: q.e });
        }
      } else {
        el.append(kit.timer(h('span.pn-slot-state.pn-timer'), { end: q.s, prefix: 'in ', doneText: 'starting', done: () => update(true) }));
        el.append(finishButton(q, name) ?? '');
        if (order && order.includes(q.k)) {
          el.dataset.k = String(q.k);
          el.classList.toggle('picked', picked === q.k);
          el.append(moveRow(q, order, name));
          // a tap on a touch screen picks the card: its ◀ ▶ show (a mouse sees them on hover)
          el.addEventListener('click', (e) => {
            if (e.target.closest('button') || !touchUi(ctx.controller)) return;
            picked = picked === q.k ? null : q.k;
            for (const c of slots.querySelectorAll('.pn-slot.queued[data-k]')) c.classList.toggle('picked', Number(c.dataset.k) === picked);
          });
        }
        // the item is named by its key (a stale or simultaneous cancel can never hit another item); an item queued
        // before keys existed just finishes
        const it = I.cancel(id, q.i, q.k);
        if (has(it.type) && probe(ctx.store, it.type, it.args) !== 'BAD_ARGS') {
          el.append(h('button.pn-slot-x', { type: 'button', title: `Cancel ${name}: every input comes back`, 'aria-label': `Cancel ${name}`,
            on: { click: () => { const r = ctx.act(it.type, it.args); if (r && r.code === 'NOT_FOUND') ctx.ui.toast('Already cancelled or collected.', { kind: 'info' }); } } }, '×'));
        }
      }
      return el;
    }

    function renderDuet(v) {
      duet.replaceChildren();
      const d = v.duet;
      if (!d) return;
      const st = ctx.store.state;
      const mine = d.by === ctx.store.pid;
      const r = v.recipes.find((x) => x.id === d.recipe);
      const ring = h('span.pn-duet-ring', { style: { '--d': `${COOP.duet.windowMs}ms` } });
      duet.append(h(`div.pn-duet${mine ? '.mine' : '.theirs'}`, ring,
        h('div', h('b', mine ? `Waiting for ${partnerName(st, ctx.store.pid)}…` : `${st.players[d.by]?.name ?? 'Your partner'} is cooking${r ? ` ${r.name}` : ''} together!`),
          h('span', mine ? 'They have 3 seconds to press "Cook together" too.' : 'Press "Cook together" now to join in.')),
        !mine && r ? kit.button({ label: 'Cook together', glyph: 'heart', cls: 'btn--stop', ...lazy(() => I.duet(id, r.id)) }) : null));
      clearTimeout(duetT);
      duetT = setTimeout(() => update(), Math.max(0, d.until - ctx.now()) + 50);
    }

    function renderRecipes(v) {
      recipes.replaceChildren();
      later.replaceChildren();
      const open = v.recipes.filter((r) => !r.locked);
      const locked = v.recipes.filter((r) => r.locked);
      // a collector (the Compost Bin) has no recipes at all: no "recipes unlock later" promise for it (UI-24)
      if (!open.length && !v.collector) recipes.append(empty('Recipes for this building unlock with the next levels.', 'book'));
      for (const r of open) recipes.append(recipeCard(v, r));
      if (locked.length) {
        later.append(h('span.pn-later-title', 'Later:'), ...locked.slice(0, 8).map((r) => h('span.pn-later-item', { title: `${r.name}: level ${r.unlock}` },
          icon(r.id, { size: 32 }), h('small', `Lv ${r.unlock}`))));
      }
    }

    function recipeCard(v, r) {
      const ins = h('div.pn-ins');
      r.inputs.forEach((x, i) => {
        if (i > 0) ins.append(h('span.pn-plus', { 'aria-hidden': 'true' }, '+'));
        if (x.item) ins.append(chip(x.item, { have: x.have, need: x.need, size: 26, inline: true }));
        else {
          // the chip pictures what it is about: a usable member, else the one held back (76 Wheat "not for feed")
          const show = x.members[0]?.id ?? x.skipped[0]?.id ?? x.any[0] ?? classMembers(x.cls)[0];
          const c = chip(show, { have: x.have, need: x.need, size: 26, inline: true });
          const label = CLASS_LABEL[x.cls] ?? x.cls;
          c.title = `${label}: ${x.members.map((m) => `${itemOf(m.id)?.name} ${m.n}`).join(', ') || 'none usable'} (cheapest first)`
            + `${x.skipped.length ? `; not used: ${x.skipped.map((s) => skipText(s)).join('; ')}` : ''}`;
          c.append(h('span.pn-chip-cls', label));
          c.dataset.hintCls = x.cls;            // its bubble lists every member of the class, and why one is skipped
          c.dataset.hintRecipe = r.id;          // ... by the rules' own walk for THIS feed (the value limit is per feed)
          ins.append(c);
        }
      });
      // a feed's soft RESERVED is "worth too much", never Keep N: its own words on the button (dialogs.js feedAsk)
      const hint = () => ({ missing: view()?.recipes.find((y) => y.id === r.id)?.missing ?? r.missing, texts: r.isFeed ? FEED_ASKS : undefined });
      const quiet = ['QUEUE_FULL'];
      const acts = h('div.pn-recipe-acts');
      const whyRow = h('div.pn-recipe-why');
      if (r.duet) {
        acts.append(
          kit.button({ label: 'Cook together', glyph: 'heart', cls: 'pn-sm btn--stop', ...lazy(() => I.duet(id, r.id)), hint, quiet, data: { duet: r.id },
            title: 'Both of you press within 3 seconds: normal time, +25 % XP and a Heart each' }),
          kit.button({ label: `Alone · ${durationText(r.slowMs)}`, cls: 'pn-xs pn-ghost', ...lazy(() => I.craft(id, r.id)), hint, quiet, data: { craft: r.id },
            title: 'Slow-cook it alone: twice the time, normal XP' }));
      } else {
        acts.append(kit.button({ label: 'Make', cls: 'pn-sm', ...lazy(() => I.craft(id, r.id)), hint, quiet, data: { craft: r.id } }));
      }
      // the reason a button is off goes under the whole card, never into the action column: a wide reason used to
      // squeeze the recipe's name to "Pum..." (QA wave 1 UI-03)
      for (const w of acts.querySelectorAll('.pn-why')) whyRow.append(w);
      const skipRow = r.skips ? skipLines(r) : null;
      const m = r.mastery;
      const masteryTitle = m.next ? `${fmt(m.count)} made · ★${m.stars + 1} at ${fmt(m.next)}` : `${fmt(m.count)} made · top mastery`;
      return h(`article.pn-recipe${r.duet ? '.duet' : ''}`, { role: 'listitem', dataset: { recipe: r.id } },
        h('div.pn-recipe-art', icon(r.id, { size: 52 }), r.out > 1 ? h('span.pn-recipe-out', `×${r.out}`) : null,
          r.tryIt ? ribbonTag('Try it', 'pn-try') : null),
        h('div.pn-recipe-main',
          h('h4.pn-recipe-name', r.name),
          h('div.pn-recipe-top', h('span.pn-recipe-stars', { title: masteryTitle }, stars(r.stars)), r.duet ? pill('Duet', 'pn-warn') : null),
          h('div.pn-recipe-facts',
            h('span', { title: r.ms < r.baseMs ? `Base ${durationText(r.baseMs)}` : 'Craft time' }, svgIcon('sprout', 14), durationText(r.ms), r.ms < r.baseMs ? h('em', ' faster') : null),
            r.isFeed ? h('span', 'upkeep') : h('span', svgIcon('coin', 14), fmt(r.sell)),
            h('span.pn-xp', `${fmt(r.duet && r.duetXp ? r.duetXp : r.xp)} XP`)),
          ins),
        acts, whyRow, skipRow);
    }

    /**
     * A feed's class members the Feed Mill leaves alone, said on the card (a phone has no hover): when one of them is
     * what stands between the farm and the feed, a line each with the reason and its one-tap way out (owner report
     * 2026-10-04: "0/3 any grain" with 76 Wheat marked "not for feed"); when the feed can be made anyway, at most one
     * muted line for items marked "not for feed". Fixed-input recipes never get one (r.skips is null).
     */
    function skipLines(r) {
      const s = r.skips;
      if (s.blocked && s.lines.length) {
        return h('div.pn-skips', { role: 'group', 'aria-label': `Why the Feed Mill can't make ${r.name}`, dataset: { skips: r.id } },
          ...s.lines.map((x) => h(`div.pn-skip.why-${x.why}`, { dataset: { skip: x.id } },
            icon(x.id, { size: 26 }),
            h('span.pn-skip-text', x.text),
            x.fix ? fixButton(r, x) : null)));
      }
      if (!s.blocked && s.quiet.length) {
        // the line opens the bubble of the first such member (tap, hover or Tab): it has the "Allow for feed" buttons
        const row = r.inputs.find((y) => y.cls && y.skipped.some((k) => k.id === s.quiet[0].id));
        const line = hintable(h('p.pn-skips-quiet', { dataset: { skips: r.id } }, quietText(s.quiet)), s.quiet[0].id,
          { cls: row?.cls, need: row?.need });
        line.dataset.hintRecipe = r.id;
        return line;
      }
      return null;
    }

    /** The way out of one skip, through the normal predicted actions (an Undo toast for the two settings). */
    function fixButton(r, x) {
      const name = itemOf(x.id)?.name ?? x.id;
      if (x.fix.kind === 'allow') {
        return kit.button({ label: x.fix.label, cls: 'pn-xs btn--sky pn-skip-fix', key: `skipfix-${r.id}-${x.id}`,
          ...lazy(() => I.noFeed(x.id, false)), data: { fix: 'allow', item: x.id }, title: `Let the Feed Mill use ${name} again`,
          onClick: () => actUndoable(ctx.act, toast, I.noFeed(x.id, false), I.noFeed(x.id, true), noFeedText(x.id, false)) });
      }
      if (x.fix.kind === 'unkeep') {
        const was = x.keep;
        return kit.button({ label: x.fix.label, cls: 'pn-xs btn--sky pn-skip-fix', key: `skipfix-${r.id}-${x.id}`,
          ...lazy(() => I.keep(x.id, 0)), data: { fix: 'unkeep', item: x.id }, title: `Keep no ${name} back (now Keep ${fmt(was)})`,
          onClick: () => actUndoable(ctx.act, toast, I.keep(x.id, 0), I.keep(x.id, was), unkeepText(x.id, was)) });
      }
      // "worth too much": the Make press itself, which answers RESERVED and opens the "Use anyway" card (dialogs.js)
      return kit.button({ label: x.fix.label, cls: 'pn-xs btn--sun pn-skip-fix', key: `skipfix-${r.id}-${x.id}`,
        ...lazy(() => I.craft(id, r.id)), data: { fix: 'confirm', item: x.id }, quiet: ['QUEUE_FULL'], hint: () => ({ texts: FEED_ASKS }),
        title: `Make ${r.name} with ${name} anyway (asks first)` });
    }

    /** args.focus: bring that recipe into view and ring it for 2 s (Show me, the Duet banner's Join). */
    let focused = false;
    function focusRecipe() {
      const want = ctx.args.focus;
      if (!want || focused) return;
      const card = recipes.querySelector(`[data-recipe="${CSS.escape(String(want))}"]`);
      if (!card) return;
      focused = true;
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.classList.add('pn-focus-ring');
      setTimeout(() => card.classList.remove('pn-focus-ring'), 2000);
      card.querySelector('button:not([aria-disabled="true"]):not([disabled])')?.focus({ preventScroll: true });
    }

    update(true);
    requestAnimationFrame(focusRecipe);
    ctx.every(1000, () => update());
    ctx.every(10_000, () => {
      for (const x of hurryLabels) {
        x.el.textContent = String(x.finish ? finishQuote(ctx.store, id, ctx.store.state.farm.objects[id]?.queue?.find((y) => y.k === x.q.k) ?? x.q, ctx.now())?.acorns ?? ''
          : hurryAcorns(x.end - ctx.now()));
      }
    });
    return { update: () => update(), destroy: () => { clearTimeout(duetT); gone = true; qdrag?.detach(); } };
  },
};

/**
 * The building's headline (pure; tests): what is ready in the tray by item ("Bread ready: 2"), else the queue state;
 * and the line under it. A finished batch always wins: "1 of 3 slots busy · all done in 0s" next to a Ready! slot
 * was a contradiction (QA wave 1 UI-24).
 */
export function headLines(v, now) {
  if (v.collector) return { ready: [], status: collectorStatus(v.collector), sub: null };
  const byItem = new Map();
  for (const q of v.queue) {
    if (q.status !== 'done') continue;
    const cur = byItem.get(q.item) || { item: q.item, name: q.recipe ? q.recipe.name : q.item, n: 0 };
    cur.n += q.out;
    byItem.set(q.item, cur);
  }
  const ready = [...byItem.values()];
  const busy = v.queue.length;
  const working = v.queue.filter((q) => q.status !== 'done');
  if (ready.length) {
    return { ready, status: null,
      sub: v.free <= 0 ? 'Ready in the tray: collect to free a slot.'
        : working.length ? `Ready in the tray. ${working.length} more on the way, all done in ${fmtDuration(Math.max(...working.map((q) => q.e)) - now)}.`
          : 'Ready in the tray: collect it whenever you like.' };
  }
  if (busy === 0) return { ready, status: 'Idle: pick something to make.', sub: 'Inputs are used when an item is queued, so a started batch can never fail. Finished goods wait in the tray.' };
  if (v.free > 0) return { ready, status: `${busy} of ${v.slots} slots busy · all done in ${fmtDuration(v.endsAt - now)}`, sub: 'Finished goods wait in the tray.' };
  const next = working[0] || v.queue[0];
  return { ready, status: `Every slot is busy · the next one frees in ${fmtDuration(next.e - now)}`,
    sub: v.nextCost !== null ? `Another slot (${fmt(v.nextCost)} coins) lines up one more.` : 'Finished goods wait in the tray.' };
}

function collectorStatus(c) {
  return c.full ? 'The bin is full: empty it to keep collecting points.'
    : `${fmt(c.points)}/${fmt(c.every)} points toward the next ${fmt(c.out)} Compost · every animal collection adds a point.`;
}

function partnerName(st, me) {
  const other = Object.keys(st.players).find((p) => p !== me);
  return other ? st.players[other].name : 'your partner';
}
