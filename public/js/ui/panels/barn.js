// The Barn (GDD §3.6, §7.3, §6.3): one shared store for everything, its capacity and the overflow pile, filters,
// Keep N (farm-wide "keep at least N", with who set it), "not for feed" and the 10-minute trash. Opened by the
// barn pill and I. Selling happens at the Market (the Sell button opens it on that stack).
import { itemOf, defOf, usesOf, live, classMembers, MARKET, SAFETY } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, createKit, bar, chip, empty, pill, who, fill, tParts, phoneTitle } from './kit.js';
import { barnView, surplusPreview, keepOf, noFeedText } from './model.js';
import { has } from './core.js';
import { I, actUndoable } from './intents.js';
import { t, N, Q, getters, name as cname } from '../../i18n/index.js';

const STATUS_TEXT = getters({
  ok: () => t('market.barn.status.ok'),
  near: () => t('market.barn.status.near'),
  overflow: () => t('market.barn.status.overflow'),
  full: () => t('market.barn.status.full'),
});

export const barnPanel = {
  title: (args, state) => (state ? phoneTitle('market.barn.title', 'market.barn.titleBare', { used: barnView(state).used, cap: barnView(state).cap })
    : t('market.barn.titleBare')),
  icon: 'barn',
  size: 'wide',
  hotkey: 'i',
  dock: { get label() { return t('market.barn.titleBare'); }, icon: 'barn', order: 3, get hint() { return t('market.barn.dockHint'); } },
  // noFeed: the "Animal feed" switch must show its new state at once (it re-rendered only on some other change)
  topics: ['inventory', 'wallet', 'keep', 'noFeed', 'trash', 'barn', 'xp'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    let filter = ctx.args.filter || 'all';
    const toast = (text, o) => ctx.ui?.toast?.(text, o);     // the Undo line of a feed / keep change
    const head = h('div.pn-barnhead');
    const chips = h('div.pn-filters', { role: 'tablist', 'aria-label': t('market.barn.filter'),
      on: { keydown: (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const tabs = [...chips.querySelectorAll('[role="tab"]:not([aria-disabled="true"])')];
        const i = tabs.indexOf(document.activeElement);
        if (i < 0) return;
        e.preventDefault();
        tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].click();
      } } });
    const list = h('div.pn-barnlist', { role: 'list' });
    const trash = h('div.pn-trash');
    body.append(head, chips, list, trash);

    const keepOpen = new Set();
    const update = kit.memo(body, () => {
      const st = ctx.store.state;
      return [filter, barnView(st), st.farm.trash, st.farm.surplus ?? null, ctx.store.pid, [...keepOpen]];
    }, render);

    function render() {
      const st = ctx.store.state;
      const v = barnView(st);
      ctx.ui.panels.retitle('barn');
      renderHead(st, v);
      // filter tabs: aria-selected only (aria-pressed is not allowed on a tab); an empty kind stays reachable and
      // says why it shows nothing (QA wave 1 UI-33)
      chips.replaceChildren(...[{ id: 'all', label: t('market.barn.all'), n: v.used }, ...v.groups].map((g) => {
        const empty = g.id !== 'all' && g.n === 0;
        return h('button.pn-chipbtn', {
          type: 'button', role: 'tab', 'aria-selected': String(filter === g.id), tabindex: filter === g.id ? '0' : '-1',
          'aria-disabled': empty ? 'true' : null, title: empty ? t('market.barn.noneOfKind', { kind: g.label.toLowerCase() }) : null,
          dataset: { key: `filter-${g.id}` }, on: { click: () => {
            if (empty) return;
            const kb = chips.contains(document.activeElement);
            filter = g.id;
            update();
            if (kb) chips.querySelector(`[data-key="filter-${g.id}"]`)?.focus();
          } },
        }, `${g.label} `, h('b', fmt(g.n)));
      }));
      list.replaceChildren();
      const rows = v.stacks.filter((s) => filter === 'all' || s.group === filter);
      if (!rows.length) list.append(empty(filter === 'all' ? t('market.barn.empty') : t('market.barn.emptyKind'), 'barn'));
      for (const s of rows) list.append(row(st, s));
      renderTrash(st);
      kit.refresh();
    }

    function renderHead(st, v) {
      const up = v.next;
      const pct = v.cap ? v.used / v.cap : 0;
      fill(head,
        h('div.pn-cap',
          icon('barn', { size: 64 }),
          h('div.pn-cap-main',
            h('div.pn-cap-line', h('b.pn-cap-n', `${fmt(v.used)} / ${fmt(v.cap)}`), h('span', t('market.barn.stored')),
              v.over > 0 ? pill(t('market.barn.inOverflow', { n: v.over }), 'pn-warn') : null),
            bar(Math.min(1, pct), null, v.status === 'ok' ? 'pn-go' : v.status === 'near' ? '' : 'pn-over'),
            h(`p.pn-cap-status.${v.status}`, STATUS_TEXT[v.status]))),
        up ? h('div.pn-upgrade',
          h('div.pn-upgrade-text', h('b', t('market.barn.upgrade', { n: up.n, add: up.add })),
            h('span', up.locked ? t('market.barn.ollieFrom', { n: up.unlock }) : t('market.barn.roomFor', { n: up.capacity })),
            // the whole ladder (ui-home's barnUpgrades: upgrades 4-10 and the materials the rest need)
            ctx.ui?.panels?.has('barnUpgrades') ? h('button.pn-chipbtn', { type: 'button',
              on: { click: () => ctx.open('barnUpgrades') } }, t('market.barn.every')) : null),
          h('div.pn-upgrade-cost', h('span.pn-cost', svgIcon('coin', 20), h('b', fmt(up.coins))),
            ...up.need.map((n) => chip(n.item, { have: n.have, need: n.n, size: 28 }))),
          kit.button({ label: t('market.barn.upgradeBtn'), glyph: 'hammer', ...lazyI(() => I.barnUpgrade()), data: { upgrade: 'barn' },
            gate: () => {
              const nx = barnView(ctx.store.state).next;
              if (!nx) return { code: 'ALREADY_DONE', hint: { done: t('market.barn.maxNow') } };
              if (nx.locked) return { code: 'LOCKED', hint: { unlock: nx.unlock } };
              if (nx.short) return { code: 'NO_COINS', hint: { coins: nx.short } };
              if (nx.missing.length) return { code: 'NO_ITEMS', hint: { missing: nx.missing } };
              return null;
            } }))
          : h('div.pn-upgrade', h('div.pn-upgrade-text', h('b', t('market.barn.biggest')), h('span', t('market.barn.later')))),
        v.status === 'overflow' || v.status === 'full' ? surplusBox(st) : null,
        surplusUndo(st));
    }

    function surplusBox(st) {
      const p = surplusPreview(st, ctx.now());
      if (!p.rows.length) return null;
      const show = p.rows.slice(0, 6);
      // the preview names every stack and its count before the click (GDD §3.6); the sale can be undone (RC-25)
      return h('div.pn-surplus',
        h('div.pn-surplus-text', h('b', t('market.barn.surplus')), h('span', t('market.barn.surplusText', { n: p.units, rows: p.rows.length, keep: MARKET.barn.surplusKeep })),
          h('small.pn-surplus-list', p.rows.map((r) => t('market.barn.surplusRow', { q: Q(r.id, r.qty) })).join(' · '))),
        h('div.pn-surplus-items', ...show.map((r) => chip(r.id, { n: r.qty, size: 32 })), p.rows.length > show.length ? h('span.pn-more', `+${p.rows.length - show.length}`) : null),
        h('span.pn-cost', svgIcon('coin', 20), h('b', `${p.exact ? '' : '~'}${fmt(p.coins)}`)),
        has(I.sellSurplus().type)
          ? kit.button({ label: t('market.barn.surplus'), cls: 'btn--sun', ...lazyI(() => I.sellSurplus()), after: (r) => { if (r && r.ok) offerUndo(p); } })
          : kit.button({ label: t('market.barn.sellAtMarket'), cls: 'btn--sun', onClick: () => ctx.open('market', { tab: 'sell' }) }));
    }

    /** After "Sell surplus": an Undo card for the 10 minutes the rules keep the sale (when this build has undoSurplus). */
    function offerUndo(p) {
      if (!has('undoSurplus')) return;
      ctx.ui.banner({ id: 'surplus-undo', kind: 'card', ribbon: t('market.barn.surplusSold'), ttl: 20_000,
        message: t('market.barn.undoMsg', { n: p.units, coins: p.coins }),
        actions: [{ label: t('market.barn.undo'), kind: 'sky', fn: () => ctx.act('undoSurplus', {}) }] });
    }

    /** The surplus sale of the last 10 minutes, with its Undo (farm.surplus from RC-25), or nothing. */
    function surplusUndo(st) {
      const sp = st.farm.surplus;
      if (!sp || !has('undoSurplus') || !(sp.at + 600_000 > ctx.now())) return null;
      return h('div.pn-surplus.pn-surplus-undo',
        h('div.pn-surplus-text', h('b', t('market.barn.surplusSold')), h('span', sp.by === ctx.store.pid
          ? t('market.barn.soldYou', { n: (sp.rows || []).reduce((n, r) => n + (r.qty ?? 0), 0) })
          : t('market.barn.soldBy', { name: st.players[sp.by]?.name ?? t('market.kit.someone'), n: (sp.rows || []).reduce((n, r) => n + (r.qty ?? 0), 0) }))),
        kit.timer(h('span.pn-timer'), { end: sp.at + 600_000, prefix: t('market.barn.undoFor') }),
        kit.button({ label: t('market.barn.undo'), cls: 'btn--sky', type: 'undoSurplus', args: {} }));
    }

    /** Items the Feed Mill may take for its ingredient classes (the "not for feed" toggle makes sense only there). */
    const feedable = new Set(live('feeds').flatMap((f) => f.classes.flatMap(({ cls }) => classMembers(cls))));

    function row(st, s) {
      const it = itemOf(s.id);
      const keep = keepOf(st, s.id);
      const uses = usesOf(s.id).length;
      const canKeep = has(I.keep(s.id, 0).type);
      const setKeep = (n) => {
        const v = Math.max(0, Math.min(SAFETY.keep.max, Math.trunc(n) || 0));
        if (v === keepOf(ctx.store.state, s.id).n) return;
        ctx.act(I.keep(s.id, v).type, I.keep(s.id, v).args);
      };
      const editing = keepOpen.has(s.id) || keep.n > 0;
      const keepBox = !canKeep ? (keep.n > 0 ? pill(t('market.sell.keeping', { n: keep.n })) : null)
        : !editing ? h('button.pn-chipbtn.pn-keep-open', { type: 'button', dataset: { key: `keep-${s.id}` },
          title: t('market.barn.keepSomeTip'),
          on: { click: () => { keepOpen.add(s.id); update(true); queueMicrotask(() => body.querySelector(`[data-key="keepn-${s.id}"]`)?.focus()); } } },
          svgIcon('lock', 14), t('market.barn.keepSome'))
          : h('div.pn-keep', { title: t('market.barn.keepTip') },
            h('span.pn-keep-label', svgIcon('lock', 16), t('market.barn.keep')),
            h('button.pn-step', { type: 'button', 'aria-label': t('market.barn.keepFewer', { item: N(s.id) }), disabled: keep.n <= 0, on: { click: () => setKeep(keep.n - (keep.n > 10 ? 5 : 1)) } }, '−'),
            h('input.pn-num.pn-keep-n', { type: 'number', min: '0', max: String(SAFETY.keep.max), value: String(keep.n), inputmode: 'numeric',
              dataset: { key: `keepn-${s.id}` }, 'aria-label': t('market.barn.keepAtLeast', { item: N(s.id) }), on: { change: (e) => setKeep(Number(e.target.value)) } }),
            h('button.pn-step', { type: 'button', 'aria-label': t('market.barn.keepMore', { item: N(s.id) }), on: { click: () => setKeep(keep.n + (keep.n >= 10 ? 5 : 1)) } }, '+'),
            keep.n > 0 && keep.by && keep.by !== 'sys' ? h('span.pn-keep-by', who(st, keep.by, { me: ctx.store.pid })) : null);
      return h(`div.pn-barnrow${s.over ? '.over' : ''}`, { role: 'listitem', dataset: { item: s.id } },
        icon(s.id, { size: 48 }),
        h('div.pn-barnrow-name', h('b', cname(s.id)),
          h('span', t('market.barn.inStock', { n: s.n }), s.over ? h('span.pn-over-tag', t('market.barn.overflowN', { n: s.over })) : null,
            uses ? t('market.barn.uses', { n: uses }) : '')),
        h('div.pn-barnrow-val', s.sellable ? [svgIcon('coin', 16), fmt(s.sell)] : h('span.pn-nosell', { title: t('market.barn.upkeepTip') }, t('market.barn.notSold'))),
        keepBox,
        h('div.pn-barnrow-acts',
          feedable.has(s.id) && has(I.noFeed(s.id, true).type) ? feedSwitch(s, it) : null,
          s.sellable ? h('button.pn-chipbtn', { type: 'button', on: { click: () => ctx.open('market', { tab: 'sell', item: s.id }) } }, t('market.barn.sell')) : null));
    }

    /**
     * "Animal feed: allowed / not allowed" for one stack: a real switch (role=switch, aria-checked) with its state in
     * words, colour and a glyph, so it can never be read as a button that does the opposite (owner report 2026-10-04:
     * a "Feed ok" chip clicked by accident kept 76 Wheat out of the Feed Mill). No confirm; an Undo toast instead.
     */
    function feedSwitch(s, it) {
      const allowed = !s.noFeed;
      const state = allowed ? t('market.barn.feed.allowed') : t('market.barn.feed.notAllowed');
      return h(`button.pn-feedswitch.pn-feedtoggle.${allowed ? 'on' : 'off'}`, {
        type: 'button', role: 'switch', 'aria-checked': String(allowed), dataset: { key: `nofeed-${s.id}` },
        'aria-label': t('market.barn.feed.aria', { item: N(s.id), state }),
        title: allowed ? t('market.barn.feed.onTip', { item: N(s.id) }) : t('market.barn.feed.offTip', { item: N(s.id) }),
        on: { click: () => {
          const on = !s.noFeed;               // the new "not for feed" value
          actUndoable(ctx.act, toast, I.noFeed(s.id, on), I.noFeed(s.id, !on), noFeedText(s.id, on));
        } },
      },
      h('span.pn-switch-track', { 'aria-hidden': 'true' }, h('span.pn-switch-knob', svgIcon(allowed ? 'check' : 'close', 14))),
      h('span.pn-switch-text', t('market.barn.feed.label'), h('b', state)));
    }

    /** Objects sold in the last 10 minutes (farm.trash): either of you can bring one back (GDD §6.3). */
    function renderTrash(st) {
      trash.replaceChildren();
      const now = ctx.now();
      const rows = Object.entries(st.farm.trash ?? {}).filter(([, r]) => r && r.until > now && r.obj).sort((a, b) => b[1].until - a[1].until);
      if (!rows.length) return;
      trash.append(h('h3.pn-h', h('span', t('market.barn.trash'))),
        ...rows.map(([id, r]) => h('div.pn-trashrow', icon(r.obj.def, { size: 36 }),
          h('span', tParts(r.coins ? 'market.barn.trashRowFor' : 'market.barn.trashRow', { item: h('b', defOf(r.obj.def) ? cname(r.obj.def) : r.obj.def),
            who: who(st, r.by, { me: ctx.store.pid }), coins: r.coins })),
          kit.timer(h('span.pn-timer'), { end: r.until, prefix: t('market.barn.goneIn') }),
          kit.button({ label: t('market.barn.bringBack'), cls: 'pn-xs', ...lazyI(() => I.restore(id)), data: { restore: id },
            hint: () => ({ coins: Math.max(0, r.coins - ctx.store.state.farm.wallet.coins) }) }))));
    }

    update();
    return { update };
  },
};

const lazyI = (f) => ({ type: () => f().type, args: () => f().args });
