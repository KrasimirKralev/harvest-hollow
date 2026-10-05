// The Acorn treasures (owner wish 2, wave 4b): unique, powerful pieces worth saving for, one per farm and yours for good,
// at the top of the Market's Acorn shop. Each card says what it does, its price, how far the Acorns go toward it, and
// "Save for this" (the Goal Tracker then shows "Saving for the …" with the Acorns so far); owned ones say who bought them
// and, for the ones used by hand, "Water everything" (the Golden Watering Can) or "Use today" (the Farmhand, the Time
// Turner: once a farm day). A placed treasure waiting in the build tray offers "Place it".
//
//   relicSection(ctx, kit) -> { el, render }   (loaded with the Acorn tab; its rows: w4b.js relicRows)
import { h, icon, svgIcon, fmt, bar, pill, ribbonTag } from './kit.js';
import { hasIcon } from '../../render/icons.js';
import { buyIntent, useIntent, relicIcon, canAct, saveForIntent } from './w4b-rules.js';
import { localSaving, setLocalSaving, relicRows } from './w4b.js';
import { startPlacement } from './placement.js';

export function relicArt(r, size = 72) {
  const art = relicIcon(r.id, hasIcon);
  return icon(art.id, { size, alt: '', cls: art.gilded ? 'pn-gilded' : '' });
}

const nameOf = (st, pid) => st.players?.[pid]?.name ?? 'You two';

export function relicSection(ctx, kit) {
  const box = h('section.pn-relics', { 'aria-labelledby': 'pn-relics-title' });
  const render = () => {
    const st = ctx.store.state;
    const pid = ctx.store.pid;
    const rows = relicRows(st, pid, ctx.now(), localSaving(pid));
    if (!rows.length) { box.replaceChildren(); box.hidden = true; return; }
    box.hidden = false;
    box.replaceChildren(
      h('header.pn-relics-head',
        h('h3#pn-relics-title', svgIcon('star', 22), 'Treasures'),
        h('p', 'One of each, yours for good. They take weeks of Acorns: pick one to save for and the goals keep count.')),
      h('div.pn-relic-grid', { role: 'list' }, ...rows.map((r) => card(r))));
    kit.refresh();
  };

  function card(r) {
    const st = ctx.store.state;
    const art = h('div.pn-relic-art', relicArt(r));
    if (r.code === 'LOCKED') art.append(h('span.pn-lock', svgIcon('lock', 18), `Level ${r.unlock}`));
    else if (r.owned) art.append(ribbonTag('Yours', 'pn-season'));
    else if (r.saving) art.append(ribbonTag('Saving', 'pn-demand'));
    const foot = h('div.pn-relic-foot');
    if (r.owned) {
      foot.append(pill(`Bought by ${r.by === ctx.store.pid ? 'you' : nameOf(st, r.by)}`, 'pn-owned'));
      const use = useIntent(r.id);
      if (use) {
        const label = r.id === 'golden_can' ? 'Water everything' : r.used ? 'Used today' : 'Use today';
        foot.append(kit.button({ label, cls: 'pn-sm btn--sky', type: () => use.type, args: () => use.args, data: { relicUse: r.id },
          hint: { texts: { COOLDOWN: 'Again tomorrow', NOT_NEEDED: 'Everything is watered', NOT_READY: 'Nothing to tend right now',
            EMPTY: 'Every workshop is idle' } }, after: (res) => { if (res && res.ok !== false) ctx.close(); } }));
      }
      if (r.stored && r.def) {
        foot.append(kit.button({ label: 'Place it', glyph: 'hammer', cls: 'pn-sm', data: { place: r.def.id },
          onClick: () => startPlacement(ctx, r.def.id) }));
      }
    } else {
      const it = buyIntent(r.id);
      foot.append(h('span.pn-cost.pn-relic-price', svgIcon('acorn', 20), fmt(r.acorns)));
      if (r.code !== 'LOCKED') {
        foot.append(kit.button({ label: 'Buy', cls: r.code === null ? 'pn-sm btn--sun' : 'pn-sm', type: () => it.type, args: () => it.args,
          data: { relicBuy: r.id }, quiet: ['NO_ACORNS', 'NO_ITEMS', 'NO_COINS'] }));
        foot.append(h(`button.pn-chipbtn.pn-relic-save${r.saving ? '.on' : ''}`, { type: 'button', 'aria-pressed': String(r.saving),
          dataset: { relicSave: r.id }, title: r.saving ? 'Stop saving for this' : 'The Goal Tracker keeps count of the Acorns for it',
          on: { click: () => {
            // the rules keep the choice for the farmer (saveFor: both screens, the tracker's card); else this browser
            if (canAct('saveFor')) { const it = saveForIntent(r.saving ? null : r.id); ctx.act(it.type, it.args); }
            else setLocalSaving(ctx.store.pid, r.saving ? null : r.id);
            render();
          } } },
        r.saving ? '★ Saving for this' : '☆ Save for this'));
      }
    }
    const progress = !r.owned && r.code !== 'LOCKED'
      ? h('div.pn-relic-progress', bar(r.have / Math.max(1, r.acorns), null, 'pn-thin pn-sun'),
        h('small', r.have >= r.acorns ? 'Enough Acorns: it can be yours now' : `${fmt(r.have)} / ${fmt(r.acorns)} Acorns · ${fmt(r.acorns - r.have)} to go`))
      : null;
    return h(`article.pn-relic${r.owned ? '.owned' : ''}${r.code === 'LOCKED' ? '.locked' : ''}${r.saving ? '.saving' : ''}`,
      { role: 'listitem', dataset: { relic: r.id, def: r.id } },
      art, h('div.pn-relic-main', h('h4.pn-card-name', r.name), h('p.pn-card-text', r.text), progress), foot);
  }

  render();
  return { el: box, render };
}
