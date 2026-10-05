// The Barn (GDD §3.6, §7.3, §6.3): one shared store for everything, its capacity and the overflow pile, filters,
// Keep N (farm-wide "keep at least N", with who set it), "not for feed" and the 10-minute trash. Opened by the
// barn pill and I. Selling happens at the Market (the Sell button opens it on that stack).
import { itemOf, defOf, usesOf, live, classMembers, MARKET, SAFETY } from '../../../../shared/content/index.js';
import { h, icon, svgIcon, fmt, createKit, bar, chip, empty, pill, who, fill } from './kit.js';
import { barnView, surplusPreview, keepOf, noFeedText } from './model.js';
import { has } from './core.js';
import { I, actUndoable } from './intents.js';

const STATUS_TEXT = {
  ok: 'Plenty of room.',
  near: 'Getting full. An upgrade or a sale will help.',
  overflow: 'Overflowing! The extra waits in crates by the door. Nothing is lost.',
  full: 'Completely full: harvests and trays wait where they are until there is room.',
};

export const barnPanel = {
  title: (args, state) => `Barn${state ? ` · ${fmt(barnView(state).used)} / ${fmt(barnView(state).cap)}` : ''}`,
  icon: 'barn',
  size: 'wide',
  hotkey: 'i',
  dock: { label: 'Barn', icon: 'barn', order: 3, hint: 'Everything you have (I)' },
  // noFeed: the "Animal feed" switch must show its new state at once (it re-rendered only on some other change)
  topics: ['inventory', 'wallet', 'keep', 'noFeed', 'trash', 'barn', 'xp'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    let filter = ctx.args.filter || 'all';
    const toast = (text, o) => ctx.ui?.toast?.(text, o);     // the Undo line of a feed / keep change
    const head = h('div.pn-barnhead');
    const chips = h('div.pn-filters', { role: 'tablist', 'aria-label': 'Filter',
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
      chips.replaceChildren(...[{ id: 'all', label: 'All', n: v.used }, ...v.groups].map((g) => {
        const empty = g.id !== 'all' && g.n === 0;
        return h('button.pn-chipbtn', {
          type: 'button', role: 'tab', 'aria-selected': String(filter === g.id), tabindex: filter === g.id ? '0' : '-1',
          'aria-disabled': empty ? 'true' : null, title: empty ? `No ${g.label.toLowerCase()} in the barn yet` : null,
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
      if (!rows.length) list.append(empty(filter === 'all' ? 'The barn is empty. Harvest something!' : 'Nothing of this kind yet.', 'barn'));
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
            h('div.pn-cap-line', h('b.pn-cap-n', `${fmt(v.used)} / ${fmt(v.cap)}`), h('span', 'items stored'),
              v.over > 0 ? pill(`${fmt(v.over)} in overflow`, 'pn-warn') : null),
            bar(Math.min(1, pct), null, v.status === 'ok' ? 'pn-go' : v.status === 'near' ? '' : 'pn-over'),
            h(`p.pn-cap-status.${v.status}`, STATUS_TEXT[v.status]))),
        up ? h('div.pn-upgrade',
          h('div.pn-upgrade-text', h('b', `Barn upgrade ${up.n}: +${fmt(up.add)} room`),
            h('span', up.locked ? `Ollie can do it from level ${up.unlock}.` : `Room for ${fmt(up.capacity)} items.`),
            // the whole ladder (ui-home's barnUpgrades: upgrades 4-10 and the materials the rest need)
            ctx.ui?.panels?.has('barnUpgrades') ? h('button.pn-chipbtn', { type: 'button',
              on: { click: () => ctx.open('barnUpgrades') } }, 'Every upgrade') : null),
          h('div.pn-upgrade-cost', h('span.pn-cost', svgIcon('coin', 20), h('b', fmt(up.coins))),
            ...up.need.map((n) => chip(n.item, { have: n.have, need: n.n, size: 28 }))),
          kit.button({ label: 'Upgrade', glyph: 'hammer', ...lazyI(() => I.barnUpgrade()), data: { upgrade: 'barn' },
            gate: () => {
              const nx = barnView(ctx.store.state).next;
              if (!nx) return { code: 'ALREADY_DONE', hint: { done: 'As big as it gets for now' } };
              if (nx.locked) return { code: 'LOCKED', hint: { unlock: nx.unlock } };
              if (nx.short) return { code: 'NO_COINS', hint: { coins: nx.short } };
              if (nx.missing.length) return { code: 'NO_ITEMS', hint: { missing: nx.missing } };
              return null;
            } }))
          : h('div.pn-upgrade', h('div.pn-upgrade-text', h('b', 'The biggest barn in the county'), h('span', 'More upgrades come with later levels.'))),
        v.status === 'overflow' || v.status === 'full' ? surplusBox(st) : null,
        surplusUndo(st));
    }

    function surplusBox(st) {
      const p = surplusPreview(st, ctx.now());
      if (!p.rows.length) return null;
      const show = p.rows.slice(0, 6);
      // the preview names every stack and its count before the click (GDD §3.6); the sale can be undone (RC-25)
      return h('div.pn-surplus',
        h('div.pn-surplus-text', h('b', 'Sell surplus'), h('span', `${fmt(p.units)} items from ${p.rows.length} stacks, keeping ${MARKET.barn.surplusKeep} of each (and anything kept).`),
          h('small.pn-surplus-list', p.rows.map((r) => `${fmt(r.qty)} ${itemOf(r.id)?.name ?? r.id}`).join(' · '))),
        h('div.pn-surplus-items', ...show.map((r) => chip(r.id, { n: r.qty, size: 32 })), p.rows.length > show.length ? h('span.pn-more', `+${p.rows.length - show.length}`) : null),
        h('span.pn-cost', svgIcon('coin', 20), h('b', `${p.exact ? '' : '~'}${fmt(p.coins)}`)),
        has(I.sellSurplus().type)
          ? kit.button({ label: 'Sell surplus', cls: 'btn--sun', ...lazyI(() => I.sellSurplus()), after: (r) => { if (r && r.ok) offerUndo(p); } })
          : kit.button({ label: 'Sell at the Market', cls: 'btn--sun', onClick: () => ctx.open('market', { tab: 'sell' }) }));
    }

    /** After "Sell surplus": an Undo card for the 10 minutes the rules keep the sale (when this build has undoSurplus). */
    function offerUndo(p) {
      if (!has('undoSurplus')) return;
      ctx.ui.banner({ id: 'surplus-undo', kind: 'card', ribbon: 'Surplus sold', ttl: 20_000,
        message: `${fmt(p.units)} items for ${fmt(p.coins)} coins. Changed your mind? Undo works for 10 minutes.`,
        actions: [{ label: 'Undo', kind: 'sky', fn: () => ctx.act('undoSurplus', {}) }] });
    }

    /** The surplus sale of the last 10 minutes, with its Undo (farm.surplus from RC-25), or nothing. */
    function surplusUndo(st) {
      const sp = st.farm.surplus;
      if (!sp || !has('undoSurplus') || !(sp.at + 600_000 > ctx.now())) return null;
      return h('div.pn-surplus.pn-surplus-undo',
        h('div.pn-surplus-text', h('b', 'Surplus sold'), h('span', `${sp.by === ctx.store.pid ? 'You' : st.players[sp.by]?.name ?? 'Someone'} sold ${fmt((sp.rows || []).reduce((n, r) => n + (r.qty ?? 0), 0))} items. Undo buys them back at the same prices.`)),
        kit.timer(h('span.pn-timer'), { end: sp.at + 600_000, prefix: 'undo for ' }),
        kit.button({ label: 'Undo', cls: 'btn--sky', type: 'undoSurplus', args: {} }));
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
      const keepBox = !canKeep ? (keep.n > 0 ? pill(`Keeping ${fmt(keep.n)}`) : null)
        : !editing ? h('button.pn-chipbtn.pn-keep-open', { type: 'button', dataset: { key: `keep-${s.id}` },
          title: 'Keep at least some: selling or feeding below it asks first',
          on: { click: () => { keepOpen.add(s.id); update(true); queueMicrotask(() => body.querySelector(`[data-key="keepn-${s.id}"]`)?.focus()); } } },
          svgIcon('lock', 14), 'Keep some')
          : h('div.pn-keep', { title: 'Keep at least this many: selling or feeding below it asks first' },
            h('span.pn-keep-label', svgIcon('lock', 16), 'Keep'),
            h('button.pn-step', { type: 'button', 'aria-label': `Keep fewer ${it.name}`, disabled: keep.n <= 0, on: { click: () => setKeep(keep.n - (keep.n > 10 ? 5 : 1)) } }, '−'),
            h('input.pn-num.pn-keep-n', { type: 'number', min: '0', max: String(SAFETY.keep.max), value: String(keep.n), inputmode: 'numeric',
              dataset: { key: `keepn-${s.id}` }, 'aria-label': `Keep at least this many ${it.name}`, on: { change: (e) => setKeep(Number(e.target.value)) } }),
            h('button.pn-step', { type: 'button', 'aria-label': `Keep more ${it.name}`, on: { click: () => setKeep(keep.n + (keep.n >= 10 ? 5 : 1)) } }, '+'),
            keep.n > 0 && keep.by && keep.by !== 'sys' ? h('span.pn-keep-by', who(st, keep.by, { me: ctx.store.pid })) : null);
      return h(`div.pn-barnrow${s.over ? '.over' : ''}`, { role: 'listitem', dataset: { item: s.id } },
        icon(s.id, { size: 48 }),
        h('div.pn-barnrow-name', h('b', it.name),
          h('span', `${fmt(s.n)} in stock`, s.over ? h('span.pn-over-tag', ` · ${fmt(s.over)} overflow`) : null,
            uses ? ` · ${uses === 1 ? 'one use' : `${uses} uses`}` : '')),
        h('div.pn-barnrow-val', s.sellable ? [svgIcon('coin', 16), fmt(s.sell)] : h('span.pn-nosell', { title: 'Upkeep: the Market does not buy it' }, 'not sold')),
        keepBox,
        h('div.pn-barnrow-acts',
          feedable.has(s.id) && has(I.noFeed(s.id, true).type) ? feedSwitch(s, it) : null,
          s.sellable ? h('button.pn-chipbtn', { type: 'button', on: { click: () => ctx.open('market', { tab: 'sell', item: s.id }) } }, 'Sell') : null));
    }

    /**
     * "Animal feed: allowed / not allowed" for one stack: a real switch (role=switch, aria-checked) with its state in
     * words, colour and a glyph, so it can never be read as a button that does the opposite (owner report 2026-10-04:
     * a "Feed ok" chip clicked by accident kept 76 Wheat out of the Feed Mill). No confirm; an Undo toast instead.
     */
    function feedSwitch(s, it) {
      const allowed = !s.noFeed;
      const state = allowed ? 'allowed' : 'not allowed';
      return h(`button.pn-feedswitch.pn-feedtoggle.${allowed ? 'on' : 'off'}`, {
        type: 'button', role: 'switch', 'aria-checked': String(allowed), dataset: { key: `nofeed-${s.id}` },
        'aria-label': `${it.name}: animal feed ${state}`,
        title: allowed ? `The Feed Mill may use ${it.name} for animal feed (cheapest first). Tap to keep it out.`
          : `The Feed Mill leaves ${it.name} alone. Tap to allow it for animal feed.`,
        on: { click: () => {
          const on = !s.noFeed;               // the new "not for feed" value
          actUndoable(ctx.act, toast, I.noFeed(s.id, on), I.noFeed(s.id, !on), noFeedText(s.id, on));
        } },
      },
      h('span.pn-switch-track', { 'aria-hidden': 'true' }, h('span.pn-switch-knob', svgIcon(allowed ? 'check' : 'close', 14))),
      h('span.pn-switch-text', 'Animal feed: ', h('b', state)));
    }

    /** Objects sold in the last 10 minutes (farm.trash): either of you can bring one back (GDD §6.3). */
    function renderTrash(st) {
      trash.replaceChildren();
      const now = ctx.now();
      const rows = Object.entries(st.farm.trash ?? {}).filter(([, r]) => r && r.until > now && r.obj).sort((a, b) => b[1].until - a[1].until);
      if (!rows.length) return;
      trash.append(h('h3.pn-h', h('span', 'Sold in the last 10 minutes')),
        ...rows.map(([id, r]) => h('div.pn-trashrow', icon(r.obj.def, { size: 36 }),
          h('span', h('b', defOf(r.obj.def)?.name ?? r.obj.def), ' · sold by ', who(st, r.by, { me: ctx.store.pid }), r.coins ? ` for ${fmt(r.coins)} coins` : ''),
          kit.timer(h('span.pn-timer'), { end: r.until, prefix: 'gone for good in ' }),
          kit.button({ label: 'Bring it back', cls: 'pn-xs', ...lazyI(() => I.restore(id)), data: { restore: id },
            hint: () => ({ coins: Math.max(0, r.coins - ctx.store.state.farm.wallet.coins) }) }))));
    }

    update();
    return { update };
  },
};

const lazyI = (f) => ({ type: () => f().type, args: () => f().args });
