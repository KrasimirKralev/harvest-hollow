// Privacy in the game (public/privacy.html is the page itself): Settings > Farm's "Privacy" section in every mode, and in
// multi-farm mode "Delete this farm now".
//
//   createPrivacyUi(S, opts?) -> { settingsRows(ctx), deleteFlow(ctx?), multi }
//     settingsRows(ctx)   "Your data": a link to the privacy note (multi: this site's /privacy; a self-hosted server: the
//                         repo's PRIVACY.md, since that server keeps the farm itself) and, multi only, "Delete this farm":
//                         a confirm that says everything goes for both farmers and cannot be undone ("Keep my farm" has
//                         the focus; no typing, no holding), then POST /api/f/:id/delete. Done: the page announces
//                         'hh:farm-deleted' and main.js shows the "This farm was deleted" gate and forgets the farm on
//                         this device (the server tells every other open screen the same with deny DELETED).
//   opts: { fetcher, win } (tests)
import { h } from './dom.js';
import { farm, session, deleteFarm } from '../net/farm.js';
import { PRIVACY_PATH, PRIVACY_MD_URL } from '../front/links.js';
import { t } from '../i18n/index.js';

export const FARM_DELETED_EVENT = 'hh:farm-deleted';

export function createPrivacyUi(S, opts = {}) {
  const { ui } = S;
  const multi = farm.multi;
  const fetcher = opts.fetcher ?? ((...a) => globalThis.fetch(...a));
  const win = opts.win ?? globalThis;
  const farmName = () => {
    const n = S.store?.state?.farm?.name;
    return typeof n === 'string' && n.trim() ? n.trim() : null;
  };

  let busy = false;
  async function deleteFlow(ctx = null) {
    if (!multi || busy) return false;
    // a short title (a panel's title fits one line on a phone); the farm's own name is in the lead
    const name = farmName();
    const lead = name ? t('privacy.delete.confirm.lead', { farm: name }) : t('privacy.delete.confirm.leadNoName');
    const yes = await ui.confirm({ title: t('privacy.delete.confirm.title'), lead, glyph: 'barn',
      body: t('privacy.delete.confirm.body'), ok: t('privacy.delete.confirm.ok'), okKind: 'stop', cancel: t('privacy.delete.confirm.cancel'),
      fine: t('privacy.delete.confirm.fine') });
    if (!yes) return false;
    busy = true;
    const r = await deleteFarm(fetcher, farm.id, session.secret);
    busy = false;
    if (!r.ok) {
      ui.toast?.(t(`privacy.delete.err.${r.code}`), { kind: 'info', ms: 5000 });
      return false;
    }
    ctx?.close?.();
    try { win.dispatchEvent?.(new CustomEvent(FARM_DELETED_EVENT, { detail: { id: farm.id } })); } catch { /* no window: tests */ }
    return true;
  }

  const link = () => (multi
    ? h('a.btn.btn--paper.btn--small', { href: PRIVACY_PATH, target: '_blank', rel: 'noopener', dataset: { privacy: 'open' } }, t('privacy.link'))
    : h('a.btn.btn--paper.btn--small', { href: PRIVACY_MD_URL, target: '_blank', rel: 'noopener noreferrer', dataset: { privacy: 'open' } }, t('privacy.link')));

  function settingsRows(ctx) {
    const rows = [
      h('h3', t('privacy.title')),
      h('div.set-row.set-privacy', h('span.lbl', t('privacy.row')), h('div', link()),
        h('span.help', t(multi ? 'privacy.help.multi' : 'privacy.help.single'))),
    ];
    if (multi) {
      rows.push(h('div.set-row.set-delete', h('span.lbl', t('privacy.delete.row')), h('div',
        h('button.btn.btn--stop.btn--small', { type: 'button', dataset: { farmDelete: 'open' }, on: { click: () => { deleteFlow(ctx); } } }, t('privacy.delete.button'))),
      h('span.help', t('privacy.delete.help'))));
    }
    return rows;
  }

  return { settingsRows, deleteFlow, multi };
}
