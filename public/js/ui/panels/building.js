// A production building (GDD §3.3 Feed Mill, §3.5 workshops, §3.4 rule 8 Compost Bin): the queue as slot cards
// (finished goods wait in the tray, the running one ticks, queued ones can be cancelled), slot upgrades, Hurry,
// and every recipe with inputs have/need, time, value, XP, mastery stars and the "Try it" ribbon. Duet recipes
// offer "Cook together" (both press within 3 s) and the solo slow-cook. Opened with args { id } (Smart Hand on a
// building, the Basket's long-press, a tracker card); args.focus = a recipe id scrolls to that recipe and rings it
// ("Show me" on a recipe unlock, the partner's Duet banner). With two workshops or more on the farm the title plank
// carries ‹ › (owner request 2026-10-19): they, ← / → / [ ] and a sideways swipe on an upright phone's title turn the
// open panel to the previous / next workshop in place (workshopRing: unlock level, then id; it wraps round).
import { itemOf, classMembers, buildingOf, BOOSTS, COOP } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, fmtDuration, createKit, hintable, stars, ribbonTag, pill, empty, bar, fill, playerMark, placeTitle, listRole } from './kit.js';
import { buildingView, hurryAcorns, hurryQuote, levelOf, durationText, skipText, quietText, noFeedText, unkeepText } from './model.js';
import { has, probe } from './core.js';
import { I, actUndoable } from './intents.js';
import { waitingOf, keyed, moveKey, reorderIntent, finishIntent, finishQuote, finishRule, useIntent, usedToday } from './w4b-rules.js';
import { touchPlayer } from '../dom.js';
import { t, Q, getters, qty as qtyOf, name as cname } from '../../i18n/index.js';
import { tParts, scrollBehavior } from './kit.js';
import { lazyImport, importFailed } from '../../net/lazy.js';

const lazy = (f) => ({ type: () => f().type, args: () => f().args });
const RULE_SEEN = 'hh.bld.ruleSeen';
function ruleSeen() { try { return globalThis.localStorage?.getItem(RULE_SEEN) === '1'; } catch { return true; } }
function markRuleSeen() { try { globalThis.localStorage?.setItem(RULE_SEEN, '1'); } catch { /* private window */ } }
/** A phone on its side (the panels' landscape block in css/mobile-panels.css). */
const sideways = () => typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(max-height: 500px) and (min-width: 601px)').matches;
/** A touch player (a touch last, or a coarse pointer): the ◀ ▶ of a waiting card show when it is tapped, not on hover. */
const touchUi = (controller) => touchPlayer(controller);
/** A recipe's ingredient class on its chip ("any grain"): one per class a feed takes (content feeds[].classes). */
export const CLASS_LABEL = getters({ grain: () => t('farm.bld.cls.grain'), root: () => t('farm.bld.cls.root'), produce: () => t('farm.bld.cls.produce'),
  veg: () => t('farm.bld.cls.veg') });
/** The reason text of a feed's RESERVED (only members worth too much are left; Make asks first). */
const FEED_ASKS = getters({ RESERVED: () => t('farm.bld.feedAsks') });

/**
 * Every workshop on the farm (each object this panel opens, the Feed Mill and the Compost Bin too) in the order the ‹ ›
 * walk them: unlock level, then def id, then object id (a second Feed Mill right after the first). Pure; no key order.
 */
export function workshopRing(state) {
  const objs = state?.farm?.objects ?? {};
  const rows = [];
  for (const id of Object.keys(objs).sort()) {
    const def = buildingOf(objs[id]?.def);
    if (def) rows.push({ id, def: def.id, at: def.unlock ?? 0 });
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return rows.sort((a, b) => a.at - b.at || cmp(a.def, b.def) || cmp(a.id, b.id)).map((r) => r.id);
}

/** The workshop `dir` (-1 / +1) steps from `id` round `ring`, wrapping; null with fewer than two or when `id` is not one. */
export function workshopStep(ring, id, dir) {
  const i = ring.indexOf(id);
  if (i < 0 || ring.length < 2) return null;
  return ring[(i + (dir < 0 ? -1 : 1) + ring.length) % ring.length];
}

/** A key the workshop arrows leave alone: a field, a widget that moves by arrows, a row that scrolls sideways. */
function ownsArrows(el, frame) {
  if (!el || el === frame || typeof el.closest !== 'function') return false;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable) return true;
  if (el.closest('[role="tab"], [role="tablist"], [role="slider"], [role="radiogroup"], [role="listbox"], [role="menu"], .pn-slot-move')) return true;
  return el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(globalThis.getComputedStyle?.(el)?.overflowX ?? '');
}

export const buildingPanel = {
  title: (args, state) => {
    const o = state && Object.hasOwn(state.farm.objects, args.id) ? state.farm.objects[args.id] : null;
    const v = o ? buildingView(state, args.id, 0) : null;
    return v ? placeTitle(v.def.id, v.name) : t('farm.bld.title');
  },
  icon: null,
  size: 'wide',
  // noFeed: the Feed Mill's "not for feed" lines change with the Barn switch (and its Allow button here)
  topics: ['objects', 'inventory', 'wallet', 'xp', 'mastery', 'joint', 'keep', 'noFeed', 'stats'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const id = ctx.args.id;
    // the workshop's rule ("ingredients leave the Barn when you start…") is read once on this device, then waits
    // behind an ⓘ (ux-phone#9, astra#6): the first Make sits on the first phone screen
    // a phone on its side never opens on it (QA r1 P-11: 390 px tall, the first Make must stay on the first screen)
    let showRule = !ruleSeen() && !sideways();
    let headMin = 0;                      // the head's tallest height this visit (px)
    if (!ruleSeen()) markRuleSeen();
    const toast = (text, o) => ctx.ui?.toast?.(text, o);     // the Undo line of a feed / keep change
    const head = h('div.pn-bhead');
    const slots = h('div.pn-slots', { role: 'list', 'aria-label': t('farm.bld.queue') });
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
    lazyImport('queue-drag', () => import('./queue-drag.js')).then((m) => {
      if (gone) return;
      qdrag = m.attachQueueDrag(slots, {
        selector: '.pn-slot.queued[data-k]',
        keyOf: (el) => Number(el.dataset.k),
        onDrop: (k, to) => reorderTo(k, to),
        onState: (on) => { dragging = on; if (!on && held) { held = false; update(true); } },
      });
    }).catch((err) => { if (!importFailed(err)) console.error('queue drag did not load', err); });

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
        slots.replaceChildren(empty(t('farm.bld.gone'), 'hammer'));
        duet.replaceChildren(); recipes.replaceChildren(); later.replaceChildren();
        return;
      }
      ctx.setTitle(placeTitle(v.def.id, v.name));
      renderHead(v);
      renderSlots(v);
      renderDuet(v);
      renderRecipes(v);
      kit.refresh();
      kit.tick();
    }

    function renderHead(v) {
      lockHead();                        // the height it has on screen now, before its words change (QA r1 P-10)
      const h2 = headLines(v, ctx.now());
      const collect = v.tray > 0 || (v.collector && v.collector.batches > 0)
        ? kit.button({ label: v.collector ? t('farm.bld.emptyBin', { n: v.collector.batches * v.collector.out }) : t('farm.bld.collect', { n: v.trayUnits }),
          glyph: 'check', cls: 'btn--sun pn-collect', ...lazy(() => I.collectTray(id)), data: { collect: id } })
        : null;
      // the idle line's rules sentence: said on the first visit, then one tap away (the ⓘ toggles it)
      const rule = h2.sub && h2.rule;
      const info = rule ? h('button.pn-chipbtn.pn-info', { type: 'button', 'aria-expanded': String(showRule), 'aria-label': t('farm.bld.ruleAria'),
        title: h2.sub, dataset: { key: 'bld-rule' }, on: { click: () => { showRule = !showRule; headMin = 0; head.style.minHeight = ''; update(true); } } }, 'ⓘ') : null;
      // a phone on its side with two kinds or more waiting: one line of icons and counts, each named for a screen reader
      // and in its tooltip (QA r2 P2-01: four "Тарт с круши · готови: 1" lines took 146 of a 390 px screen)
      const mini = h2.ready.length >= 2 && sideways();
      fill(head, h('div.pn-bhead-art', icon(v.def.id, { size: 72 })),
        h('div.pn-bhead-text',
          h('p.pn-bhead-status', h2.ready.length
            ? (mini ? [h('span.pn-ready-lead', t('farm.bld.readyLead')), ...h2.ready.map((r) => {
              const say = t('farm.bld.ready', { name: r.name, n: r.n });
              return h('span.pn-ready.pn-ready-mini', { title: say, role: 'img', 'aria-label': say }, icon(r.item, { size: 28, alt: '' }), `×${fmt(r.n)}`);
            })] : h2.ready.map((r) => h('span.pn-ready', icon(r.item, { size: 28 }), t('farm.bld.ready', { name: r.name, n: r.n }))))
            : h2.status, info),
          h2.sub && (!rule || showRule) ? h('p.pn-bhead-sub', h2.sub) : null),
        collect, turnerButton(v));
      lockHead();
    }

    /**
     * QA r1 P-10: the head never shrinks while the sheet is open (the first visit's rule paragraph gives way to "1 of 6
     * slots busy" after the first Make, and the recipes jumped up under the second tap); the ⓘ resets it.
     */
    function lockHead() {
      const hh = head.offsetHeight || 0;
      if (hh > headMin) { headMin = hh; head.style.minHeight = `${hh}px`; }
    }

    function renderSlots(v) {
      slots.replaceChildren();
      hurryLabels.length = 0;
      if (v.collector) {
        const c = v.collector;
        slots.append(h('div.pn-collector', bar(c.points / c.every, `${fmt(c.points)} / ${fmt(c.every)}`, 'pn-go'),
          h('div.pn-collector-batches', ...Array.from({ length: c.max }, (_, i) => h(`span.pn-batch${i < c.batches ? '.full' : ''}`,
            icon(c.item, { size: 40 }), h('small', `×${c.out}`))))));
        listRole(slots);                 // a collector's meter is not a list of slots (QA r1 P-19 sibling)
        return;
      }
      // the queue row is as tall empty as it is busy: the first Make never moves under the second tap (QA r1 P-10:
      // it jumped 63-102 px when the strip turned into slot cards); the slots' height depends on the Hurry button
      slots.classList.toggle('pn-hurry-on', levelOf(ctx.store.state) >= BOOSTS.hurry.unlock);
      // an empty queue is one strip, "Queue 0/6", not six boxes that say "empty" (ux-phone#9, astra#6)
      if (!v.queue.length) {
        slots.classList.remove('pn-orderable');
        qtip.hidden = true;
        // the strip is as wide as the slot cards it stands for (--n), so the buy card shares its row exactly when it will
        // share the busy row: the first Make stays put under the second press (QA r2 P2-C1, carried P-10: with fewer
        // than 6 slots the buy card wrapped under a full-width strip and the recipes rose a row after the first Make)
        slots.append(h('div.pn-slot.pn-slot-strip', { role: 'listitem', style: { '--n': String(v.slots) } }, h('span.pn-slot-plus', { 'aria-hidden': 'true' }, '+'), h('span', t('farm.bld.queueOf', { n: 0, max: v.slots }))));
        if (v.nextCost !== null) slots.append(buySlot(v));
        listRole(slots);
        return;
      }
      const wait = waitingOf(v.obj, ctx.now());
      const order = wait.length > 1 && keyed(wait) ? wait.map((x) => x.k) : null;
      const canOrder = Boolean(order && reorderIntent(ctx.store, id, order));
      if (picked !== null && !(order && order.includes(picked))) picked = null;
      for (const q of v.queue) slots.append(slotCard(v, q, canOrder ? order : null));
      slots.classList.toggle('pn-orderable', canOrder);
      qtip.hidden = !canOrder;
      qtip.textContent = touchUi(ctx.controller) ? t('farm.bld.qtipTouch') : t('farm.bld.qtip');
      for (let i = v.queue.length; i < v.slots; i++) {
        slots.append(h('div.pn-slot.empty', { role: 'listitem' }, h('span.pn-slot-plus', '+'), h('small', t('farm.bld.emptySlot'))));
      }
      if (v.nextCost !== null) slots.append(buySlot(v));
      listRole(slots);
    }

    function buySlot(v) {
      return h('div.pn-slot.buy', { role: 'listitem' },
        h('small', t('farm.bld.slotOf', { n: v.slots + 1, max: v.max })),
        kit.button({ label: fmt(v.nextCost), glyph: 'coin', cls: 'pn-xs btn--sky', ...lazy(() => I.addSlot(id)), data: { addslot: id },
          hint: () => ({ coins: Math.max(0, v.nextCost - ctx.store.state.farm.wallet.coins) }) }));
    }

    /** The Time Turner (wave 4b relic), once a farm day: every queue on the farm finishes now. Only while it can. */
    function turnerButton(v) {
      const st = ctx.store.state;
      const it = useIntent('time_turner');
      if (!it || !st.farm.relics?.time_turner || usedToday(st, 'time_turner', ctx.now()) || !v.queue.some((q) => q.status !== 'done')) return null;
      return kit.button({ label: t('farm.bld.turner'), glyph: 'star', cls: 'pn-sm btn--sky pn-turner', type: () => it.type, args: () => it.args,
        data: { relicUse: 'time_turner' }, title: t('farm.bld.turnerTip') });
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
      if (r && r.ok === false && r.code === 'NOT_FOUND') ctx.ui.toast(t('farm.bld.started'), { kind: 'info' });
      update(true);
    }

    /** ◀ ▶ under a waiting card: one step sooner / later. */
    function moveRow(q, order, name) {
      const at = order.indexOf(q.k);
      const step = (d, glyph, label) => h(`button.pn-move-btn`, { type: 'button', dataset: { move: String(d), key: `move-${q.k}-${d}` },
        disabled: (d < 0 && at <= 0) || (d > 0 && at >= order.length - 1), title: label, 'aria-label': label,
        on: { click: (e) => { e.stopPropagation(); reorderTo(q.k, at + d); } } }, glyph);
      return h('div.pn-slot-move', step(-1, '◀', t('farm.bld.sooner', { name })), step(1, '▶', t('farm.bld.later', { name })));
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
        title: t('farm.bld.finishTip', { name, n: cost(), rule: finishRule() }),
        type: () => it.type, args: () => it.args, data: { finish: String(q.k) },
        hint: () => ({ acorns: Math.max(0, cost() - ctx.store.state.farm.wallet.acorns) }) });
      btn.button.setAttribute('aria-label', t('farm.bld.finishAria', { name, n: cost() }));
      hurryLabels.push({ el: btn.button.querySelector('.pn-btn-label'), q, finish: true });
      return btn;
    }

    function slotCard(v, q, order = null) {
      const r = q.recipe;
      const name = r ? cname(r.id) : q.item;
      const st = ctx.store.state;
      const el = h(`div.pn-slot.${q.status}${q.duet ? '.duet' : ''}`, { role: 'listitem', dataset: { slot: String(q.i) },
        title: q.by ? t('farm.bld.slotBy', { name, who: st.players[q.by]?.name ?? q.by }) : name },
      icon(q.item, { size: 48 }), q.out > 1 ? h('span.pn-slot-out', `×${q.out}`) : null,
      q.by && st.players[q.by] ? h('span.pn-slot-by', playerMark(q.by, st.players[q.by], { title: t('farm.bld.queuedBy', { who: st.players[q.by].name }) })) : null);
      if (q.status === 'done') {
        el.append(h('span.pn-slot-state', t('market.kit.ready')), h('span.pn-sparkle', { 'aria-hidden': 'true' }));
      } else if (q.status === 'running') {
        const fill = bar(0, null, 'pn-thin pn-sky');
        el.append(fill, kit.timer(h('span.pn-slot-state.pn-timer'), { end: q.e, start: q.s, bar: fill, done: () => update(true) }));
        if (q.duet || q.slow) {
          el.append(h('span.pn-slot-tags', q.duet ? ribbonTag(t('farm.bld.together'), 'pn-try') : null,
            q.slow ? ribbonTag(t('farm.bld.slow'), 'pn-season') : null));
        }
        if (levelOf(st) >= BOOSTS.hurry.unlock) {
          const cost = () => hurryQuote(ctx.store.state, id, ctx.now())?.acorns ?? hurryAcorns(q.e - ctx.now());
          const hurry = kit.button({ label: `${cost()}`, glyph: 'acorn', cls: 'pn-xs btn--sun pn-hurry',
            title: t('farm.bld.hurryTip'), ...lazy(() => I.hurry(id)), data: { hurry: id },
            hint: () => ({ acorns: Math.max(0, cost() - ctx.store.state.farm.wallet.acorns) }) });
          el.append(hurry);
          hurryLabels.push({ el: hurry.button.querySelector('.pn-btn-label'), end: q.e });
        }
      } else {
        el.append(kit.timer(h('span.pn-slot-state.pn-timer'), { end: q.s, prefix: t('farm.bld.in'), doneText: t('farm.bld.starting'), done: () => update(true) }));
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
          el.append(h('button.pn-slot-x', { type: 'button', title: t('farm.bld.cancelTip', { name }), 'aria-label': t('farm.bld.cancel', { name }),
            on: { click: () => { const r = ctx.act(it.type, it.args); if (r && r.code === 'NOT_FOUND') ctx.ui.toast(t('farm.bld.cancelled'), { kind: 'info' }); } } }, '×'));
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
        h('div', h('b', mine ? t('farm.bld.waitFor', { name: partnerName(st, ctx.store.pid) })
          : r ? t('farm.bld.cookingDish', { name: st.players[d.by]?.name ?? t('common.partner'), dish: r.name })
            : t('farm.bld.cooking', { name: st.players[d.by]?.name ?? t('common.partner') })),
          h('span', mine ? t('farm.bld.threeSec') : t('farm.bld.joinIn'))),
        !mine && r ? kit.button({ label: t('farm.bld.cookTogether'), glyph: 'heart', cls: 'btn--stop', ...lazy(() => I.duet(id, r.id)) }) : null));
      clearTimeout(duetT);
      duetT = setTimeout(() => update(), Math.max(0, d.until - ctx.now()) + 50);
    }

    function renderRecipes(v) {
      recipes.replaceChildren();
      later.replaceChildren();
      const open = v.recipes.filter((r) => !r.locked);
      const locked = v.recipes.filter((r) => r.locked);
      // a collector (the Compost Bin) has no recipes at all: no "recipes unlock later" promise for it (UI-24)
      if (!open.length && !v.collector) recipes.append(empty(t('farm.bld.noRecipes'), 'book'));
      for (const r of open) recipes.append(recipeCard(v, r));
      listRole(recipes);
      if (locked.length) {
        later.append(h('span.pn-later-title', t('farm.bld.laterTitle')), ...locked.slice(0, 8).map((r) => h('span.pn-later-item', { title: t('farm.bld.laterTip', { name: r.name, n: r.unlock }) },
          icon(r.id, { size: 32 }), h('small', t('common.levelShort', { n: r.unlock })))));
      }
    }

    function recipeCard(v, r) {
      const ins = h('div.pn-ins');
      // the chips are pills with a gap between them: no "·" that could start a line alone when they wrap (QA r1 P-15)
      r.inputs.forEach((x) => {
        if (x.item) ins.append(inputChip(x.item, x.need, x.have));
        else {
          // the chip pictures what it is about: a usable member, else the one held back (76 Wheat "not for feed")
          const show = x.members[0]?.id ?? x.skipped[0]?.id ?? x.any[0] ?? classMembers(x.cls)[0];
          const label = CLASS_LABEL[x.cls] ?? x.cls;
          const c = inputChip(show, x.need, x.have, label);
          const members = x.members.map((m) => t('market.skip.stack', { item: cname(m.id), n: m.n })).join(', ') || t('farm.bld.noneUsable');
          c.title = x.skipped.length ? t('farm.bld.clsTipSkip', { label, list: members, skipped: x.skipped.map((s) => skipText(s)).join('; ') })
            : t('farm.bld.clsTip', { label, list: members });
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
          kit.button({ label: t('farm.bld.cookTogether'), glyph: 'heart', cls: 'pn-sm btn--stop', ...lazy(() => I.duet(id, r.id)), hint, quiet, data: { duet: r.id },
            title: t('farm.bld.duetTip') }),
          kit.button({ label: t('farm.bld.alone', { d: durationText(r.slowMs) }), cls: 'pn-xs pn-ghost', ...lazy(() => I.craft(id, r.id)), hint, quiet, data: { craft: r.id },
            title: t('farm.bld.aloneTip') }));
      } else {
        acts.append(kit.button({ label: t('farm.bld.make'), cls: 'pn-sm', ...lazy(() => I.craft(id, r.id)), hint, quiet, data: { craft: r.id } }));
      }
      // the reason a button is off goes under the whole card, never into the action column: a wide reason used to
      // squeeze the recipe's name to "Pum..." (QA wave 1 UI-03)
      for (const w of acts.querySelectorAll('.pn-why')) whyRow.append(w);
      const skipRow = r.skips ? skipLines(r) : null;
      const m = r.mastery;
      const masteryTitle = m.next ? t('farm.bld.madeNext', { n: m.count, s: m.stars + 1, next: m.next }) : t('farm.bld.madeTop', { n: m.count });
      return h(`div.pn-recipe${r.duet ? '.duet' : ''}`, { role: 'listitem', dataset: { recipe: r.id } },
        h('div.pn-recipe-art', icon(r.id, { size: 52 }), r.out > 1 ? h('span.pn-recipe-out', `×${r.out}`) : null),
        h('div.pn-recipe-main',
          h('h3.pn-recipe-name', r.name),
          // QA r3 P3-02: "New recipe" takes the place of a never-made recipe's empty stars; on the 64-72 px art it wrapped
          // to two lines over the recipe's icon (desktop too)
          h('div.pn-recipe-top', r.tryIt ? ribbonTag(t('farm.bld.tryIt'), 'pn-try')
            : h('span.pn-recipe-stars', { title: masteryTitle }, stars(r.stars)), r.duet ? pill(t('farm.bld.duet'), 'pn-warn') : null),
          h('div.pn-recipe-facts',
            h('span', { title: r.ms < r.baseMs ? t('farm.bld.base', { d: durationText(r.baseMs) }) : t('farm.bld.craftTime') }, svgIcon('sprout', 14), durationText(r.ms), r.ms < r.baseMs ? h('em', t('farm.bld.faster')) : null),
            r.isFeed ? h('span', t('farm.bld.upkeep')) : h('span', svgIcon('coin', 14), fmt(r.sell)),
            h('span.pn-xp', t('common.xp', { n: r.duet && r.duetXp ? r.duetXp : r.xp }))),
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
        return h('div.pn-skips', { role: 'group', 'aria-label': t('farm.bld.whyNot', { name: r.name }), dataset: { skips: r.id } },
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
      const name = itemOf(x.id) ? cname(x.id) : x.id;
      if (x.fix.kind === 'allow') {
        return kit.button({ label: x.fix.label, cls: 'pn-xs btn--sky pn-skip-fix', key: `skipfix-${r.id}-${x.id}`,
          ...lazy(() => I.noFeed(x.id, false)), data: { fix: 'allow', item: x.id }, title: t('farm.bld.fixAllow', { name }),
          onClick: () => actUndoable(ctx.act, toast, I.noFeed(x.id, false), I.noFeed(x.id, true), noFeedText(x.id, false)) });
      }
      if (x.fix.kind === 'unkeep') {
        const was = x.keep;
        return kit.button({ label: x.fix.label, cls: 'pn-xs btn--sky pn-skip-fix', key: `skipfix-${r.id}-${x.id}`,
          ...lazy(() => I.keep(x.id, 0)), data: { fix: 'unkeep', item: x.id }, title: t('farm.bld.fixUnkeep', { name, was }),
          onClick: () => actUndoable(ctx.act, toast, I.keep(x.id, 0), I.keep(x.id, was), unkeepText(x.id, was)) });
      }
      // "worth too much": the Make press itself, which answers RESERVED and opens the "Use anyway" card (dialogs.js)
      return kit.button({ label: x.fix.label, cls: 'pn-xs btn--sun pn-skip-fix', key: `skipfix-${r.id}-${x.id}`,
        ...lazy(() => I.craft(id, r.id)), data: { fix: 'confirm', item: x.id }, quiet: ['QUEUE_FULL'], hint: () => ({ texts: FEED_ASKS }),
        title: t('farm.bld.fixConfirm', { dish: r.name, name }) });
    }

    /** args.focus: bring that recipe into view and ring it for 2 s (Show me, the Duet banner's Join). */
    let focused = false;
    function focusRecipe() {
      const want = ctx.args.focus;
      if (!want || focused) return;
      const card = recipes.querySelector(`[data-recipe="${CSS.escape(String(want))}"]`);
      if (!card) return;
      focused = true;
      card.scrollIntoView({ block: 'center', behavior: scrollBehavior() });
      card.classList.add('pn-focus-ring');
      setTimeout(() => card.classList.remove('pn-focus-ring'), 2000);
      card.querySelector('button:not([aria-disabled="true"]):not([disabled])')?.focus({ preventScroll: true });
    }

    // ---- ‹ › to the previous / next workshop (owner request 2026-10-19) ----
    // They live on the shell's title plank (the frame stays while the panel is open); a switch re-opens this panel with
    // the other id, which re-mounts the body in place: no close, no entrance, the camera stays where it is.
    const plank = [...(ctx.el?.children ?? [])].find((c) => c.classList?.contains('hh-panel-title')) ?? null;
    const nav = { btns: [], key: null, ring: [] };
    function go(dir) {
      const to = workshopStep(workshopRing(ctx.store.state), id, dir);
      const fromBtn = Boolean(globalThis.document?.activeElement?.classList?.contains('pn-wsnav'));
      if (!to || !ctx.ui?.panels?.open?.(ctx.name, { id: to })) return;
      // the frame keeps its scroll from the last workshop: the next one opens at its top (a phone on its side scrolls
      // the whole sheet)
      const sc = ctx.el.querySelector?.('.hh-panel-scroll');
      if (sc) sc.scrollTop = 0;
      ctx.el.scrollTop = 0;
      // the shell focused the frame: the same arrow takes the focus back, so Enter / Space can go on round the ring
      if (fromBtn) ctx.el.querySelector?.(`.pn-wsnav[data-dir="${dir}"]`)?.focus({ preventScroll: true });
    }
    function navButton(dir, to) {
      const say = t(dir < 0 ? 'farm.bld.prev' : 'farm.bld.next', { name: cname(ctx.store.state.farm.objects[to].def) });
      return h('button.btn.btn--round.btn--small.pn-wsnav', { type: 'button', 'aria-label': say, title: say, dataset: { dir: String(dir), to },
        on: {
          click: () => go(dir),
          // the title is a phone sheet's grip (swipe down to close): a press on an arrow is not that swipe (its pointer
          // capture would take the tap's click away from the button)
          pointerdown: (ev) => ev.stopPropagation(),
        } }, dir < 0 ? '‹' : '›');
    }
    function syncNav() {
      if (!plank) return;
      const ring = (nav.ring = workshopRing(ctx.store.state));
      const prev = workshopStep(ring, id, -1);
      const next = workshopStep(ring, id, 1);
      const key = next ? `${prev}|${next}` : '';
      if (key === nav.key) return;
      nav.key = key;
      for (const b of nav.btns) b.remove();
      nav.btns = next ? [navButton(-1, prev), navButton(1, next)] : [];
      plank.classList.toggle('pn-wsnav-on', nav.btns.length > 0);
      if (nav.btns.length) { plank.prepend(nav.btns[0]); plank.append(nav.btns[1]); }
    }
    const navTouched = (ch) => !ch || ch.topics?.has('*') || (ch.topics?.has('objects') && (!ch.ids?.size
      || [...ch.ids].some((x) => nav.ring.includes(x) || buildingOf(ctx.store.state.farm.objects[x]?.def))));
    syncNav();
    // (a test's bare ctx may have no frame or no ctx.on: no keys, no swipe there)
    const listen = (ev, fn) => { if (ctx.el && typeof ctx.on === 'function') ctx.on(ctx.el, ev, fn); };
    listen('keydown', (e) => {
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || !nav.btns.length) return;
      // the physical [ ] keys (a Bulgarian layout types ш щ there); arrows by their meaning
      const dir = e.key === 'ArrowLeft' || e.code === 'BracketLeft' ? -1 : e.key === 'ArrowRight' || e.code === 'BracketRight' ? 1 : 0;
      if (!dir || qdrag?.active?.() || ownsArrows(e.target, ctx.el)) return;
      e.preventDefault();               // the controller's ← → pan the farm otherwise
      go(dir);
    });
    // an upright phone: a sideways swipe on the title turns too (swiping it down still closes the sheet; on a phone on
    // its side a swipe to the right closes it, so none there)
    let swipe = null;
    listen('pointerdown', (e) => {
      const upright = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(max-width: 600px)').matches;   // LAYOUT_Q.portrait
      swipe = upright && e.pointerType !== 'mouse' && nav.btns.length && e.target?.closest?.('.hh-panel-title')
        ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
    });
    listen('pointerup', (e) => {
      if (!swipe || e.pointerId !== swipe.id) return;
      const dx = e.clientX - swipe.x;
      const dy = e.clientY - swipe.y;
      swipe = null;
      if (Math.abs(dx) >= 48 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
    });

    update(true);
    requestAnimationFrame(focusRecipe);
    ctx.every(1000, () => update());
    ctx.every(10_000, () => {
      for (const x of hurryLabels) {
        x.el.textContent = String(x.finish ? finishQuote(ctx.store, id, ctx.store.state.farm.objects[id]?.queue?.find((y) => y.k === x.q.k) ?? x.q, ctx.now())?.acorns ?? ''
          : hurryAcorns(x.end - ctx.now()));
      }
    });
    return {
      // a workshop placed or gone (either farmer) brings or takes the arrows and changes their neighbours; a crop or an
      // animal changing does not re-read the farm
      update: (ch) => { if (navTouched(ch)) syncNav(); update(); },
      destroy: () => {
        clearTimeout(duetT); gone = true; qdrag?.detach();
        for (const b of nav.btns) b.remove();
        plank?.classList.remove('pn-wsnav-on');
      },
    };
  },
};

/**
 * One recipe input as words, "1 Flour" ("3 any grain" for a class), with a red "need 1 more" only when the Barn is
 * short; the stock is in the tooltip (astra#6: "15/1" read as a fraction). Opens the where-to-get-it bubble like a chip.
 */
export function inputChip(item, need, have, cls = null) {
  const short = Math.max(0, need - (have ?? 0));
  const name = itemOf(item) ? cname(item) : item;
  const words = cls ? t('farm.bld.inCls', { n: need, cls }) : itemOf(item) ? qtyOf(item, need) : `${fmt(need)} ${name}`;
  return h(`span.pn-chip.pn-input.inline${short ? '.short' : '.ok'}`, {
    title: t('market.kit.chipNeed', { item: cls ?? name, have: have ?? 0, need }),
    dataset: { item, need: String(need) }, tabindex: '0',
  }, icon(item, { size: 26, alt: '' }),
  // the words and "need 1 more" share one column beside the icon (QA r1 P-15: the icon sat on a line of its own)
  h('span.pn-input-txt', h('span.pn-input-n', words), short ? ' ' : null, short ? h('span.pn-input-need', t('farm.bld.needMore', { n: short })) : null));
}

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
    const cur = byItem.get(q.item) || { item: q.item, name: q.recipe ? cname(q.recipe.id) : q.item, n: 0 };
    cur.n += q.out;
    byItem.set(q.item, cur);
  }
  const ready = [...byItem.values()];
  const busy = v.queue.length;
  const working = v.queue.filter((q) => q.status !== 'done');
  if (ready.length) {
    return { ready, status: null,
      sub: v.free <= 0 ? t('farm.bld.readyFree')
        : working.length ? t('farm.bld.readyMore', { n: working.length, d: fmtDuration(Math.max(...working.map((q) => q.e)) - now) })
          : t('farm.bld.readyAny') };
  }
  if (busy === 0) return { ready, status: t('farm.bld.idle'), sub: t('farm.bld.idleSub'), rule: true };
  if (v.free > 0) return { ready, status: t('farm.bld.busySome', { busy, slots: v.slots, d: fmtDuration(v.endsAt - now) }), sub: t('farm.bld.waitTray') };
  const next = working[0] || v.queue[0];
  return { ready, status: t('farm.bld.busyAll', { d: fmtDuration(next.e - now) }),
    sub: v.nextCost !== null ? t('farm.bld.anotherSlot', { n: v.nextCost }) : t('farm.bld.waitTray') };
}

function collectorStatus(c) {
  return c.full ? t('farm.bld.binFull')
    : t('farm.bld.binPoints', { points: c.points, every: c.every, q: Q('compost', c.out) });
}

function partnerName(st, me) {
  const other = Object.keys(st.players).find((p) => p !== me);
  return other ? st.players[other].name : t('farm.bld.partnerObj');
}
