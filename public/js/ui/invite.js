// Multi-farm hosted mode (docs/agent-briefs/multi-farm.md): "Invite a friend" and "Your personal farm link".
// Only in multi mode (a page at /f/<farmId>); createInviteUi returns null otherwise and nothing changes.
//
//   createInviteUi(S) -> { open(), settingsRows(ctx), full() } | null
//     the 'invite' panel (card): a one-time invite link /f/<id>?join=<token> (POST /api/f/:id/invite), Copy and the
//     phone's share sheet (navigator.share) where there is one; a new link replaces the old one (said so); a farm with
//     two farmers says so instead. The link made is kept for this farm (kv 'hh.invite') until it expires.
//     settingsRows(ctx): Settings > Farm in multi mode: Invite a friend, the personal link (shown on request; Copy,
//     Share; "keep it private, it is your key") and the retention line.
//     The nudge: once per farm, a few seconds after this farmer's first guide step is done (Grandma's first evening),
//     a gentle card "Farming is better with two" with "Invite a friend" (never on a farm that has two farmers).
//   copyText(text, { input }) -> Promise<boolean>   the clipboard, else the old select + execCommand('copy')
//   linkBox(url, { label, masked, shareText })       a link field with Copy (and Share on a phone; shareText may be the
//                                                     share sheet's own words), also used by ui/keep.js
//   INVITE_TEXT                                       the words (tests)
// A farm with two farmers: the card also offers a new key for a farmer who lost theirs (ui/keep.js fullRows), so a
// lost phone never leaves the farm "full" for good.
import { h, kv, svgIcon, ensureStylesheet } from './dom.js';
import { farm, session, createInvite, inviteLink, personalLink, TTL_DAYS } from '../net/farm.js';
import { t, tn, getters, lang } from '../i18n/index.js';

const DAY_MS = 86_400_000;
const NUDGE_DELAY_MS = 2500;

export const INVITE_TEXT = getters({
  lead: () => t('multi.invite.lead'),
  rules: () => tn('multi.invite.rules', TTL_DAYS),
  full: () => t('multi.invite.full'),
  personal: () => t('multi.personal.help'),
  retention: () => tn('multi.retention', TTL_DAYS),
  nudge: () => t('multi.invite.nudge'),
  share: () => t('multi.invite.share'),
  errors: {
    FULL: () => t('multi.invite.err.FULL'),
    AUTH: () => t('multi.invite.err.AUTH'),
    RATE: () => t('multi.invite.err.RATE'),
    NET: () => t('multi.invite.err.NET'),
  },
});

/** Copy to the clipboard; on an http page (no clipboard API) select the field and use the old command. */
export async function copyText(text, { input = null, nav = globalThis.navigator, doc = globalThis.document } = {}) {
  try {
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') { await nav.clipboard.writeText(text); return true; }
  } catch { /* denied: try the old way */ }
  // the old command copies the SELECTION: with no field holding the text it would copy nothing and still say yes
  if (!input) return false;
  try {
    input.focus();
    input.select();
    input.setSelectionRange?.(0, text.length);
    return Boolean(doc?.execCommand?.('copy'));
  } catch { return false; }
}

/** The Settings line about deleting a farm nobody visits (the server's HH_FARM_TTL_DAYS, 7 by default). Pure. */
export const retentionText = (days = TTL_DAYS) => tn('multi.retention', days);

const canShare = (nav = globalThis.navigator) => typeof nav?.share === 'function';

async function share(url, text = INVITE_TEXT.share, nav = globalThis.navigator) {
  try {
    await nav.share({ title: 'Harvest Hollow', text, url }); // i18n-ok: brand
    return true;
  } catch { return false; }   // the player closed the sheet: nothing to say
}

/** A link field with Copy and (on a phone) Share, and a status line. `masked`: shown only after "Show". */
export function linkBox(url, { label, masked = false, shareText = true } = {}) {
  const status = h('p.link-status', { role: 'status', 'aria-live': 'polite' });
  const field = h('input.field.link-field', { type: 'text', readonly: true, value: masked ? '' : url, 'aria-label': label, spellcheck: 'false' });
  if (masked) field.placeholder = t('multi.link.hidden');
  field.addEventListener('focus', () => { if (field.value) field.select(); });
  const copy = h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { act: 'copy' }, on: { click: async () => {
    const ok = await copyText(url, { input: field.value ? field : null });
    status.textContent = ok ? t('multi.link.copied') : t('multi.link.hold');
    if (!ok && !field.value) { field.value = url; field.select(); }
  } } }, t('multi.link.copy'));
  const acts = [copy];
  if (shareText && canShare()) {
    acts.push(h('button.btn.btn--small', { type: 'button', dataset: { act: 'share' },
      on: { click: () => share(url, typeof shareText === 'string' ? shareText : INVITE_TEXT.share) } }, t('multi.link.share')));
  }
  if (masked) {
    const show = h('button.btn.btn--paper.btn--small', { type: 'button', 'aria-pressed': 'false', dataset: { act: 'show' }, on: { click: () => {
      const on = !field.value;
      field.value = on ? url : '';
      show.textContent = on ? t('multi.link.hide') : t('multi.link.show');
      show.setAttribute('aria-pressed', String(on));
    } } }, t('multi.link.show'));
    acts.unshift(show);
  }
  return h('div.link-box', field, h('div.link-acts', acts), status);
}

export function createInviteUi(S) {
  if (!farm.multi) return null;
  const { store, ui } = S;
  ensureStylesheet('/css/farm.css');
  const full = () => Object.keys(store.state?.players ?? {}).length >= 2;
  const origin = () => globalThis.location?.origin ?? '';
  const saved = () => {
    const v = kv.get('hh.invite');
    if (!v || typeof v.token !== 'string') return null;
    const until = Number.isFinite(v.expiresAt) ? v.expiresAt : (v.madeAt || 0) + TTL_DAYS * DAY_MS;
    return until > Date.now() ? v : null;
  };

  ui.panels.register('invite', {
    // a getter, not a function: the shell reads it at every open, so it follows the language
    get title() { return t('multi.invite.title'); },
    size: 'card',
    topics: ['players'],
    mount(body, ctx) {
      const wrap = h('div.invite');
      body.append(wrap);
      let busy = false;
      // the card listens to `players`, which changes on every presence beat: repaint only when what it shows changed,
      // or a tap that spans a repaint lands on a button that is no longer there (live walk 2026-10-05)
      let shown = null;
      const paint = (error = null, force = true) => {
        const sig = JSON.stringify([full(), saved()?.token ?? null, busy, error, S.keep?.fullSig?.() ?? null, lang()]);
        if (!force && sig === shown) return;
        shown = sig;
        if (full()) {
          // a farmer who lost their key keeps their seat: the way to fill it again is a new key (ui/keep.js)
          wrap.replaceChildren(h('div.invite-art', svgIcon('heart', 64)), h('p.invite-lead', INVITE_TEXT.full),
            ...(S.keep ? S.keep.fullRows(ctx) : []),
            h('div.invite-acts', h('button.btn', { type: 'button', on: { click: () => ctx.close() } }, t('multi.invite.back'))));
          return;
        }
        const inv = saved();
        const make = h(`button.btn${inv ? '.btn--paper.btn--small' : ''}`, { type: 'button', dataset: { act: 'make' }, disabled: busy || null,
          on: { click: () => makeLink() } }, busy ? t('multi.invite.making') : inv ? t('multi.invite.makeNew') : t('multi.invite.make'));
        wrap.replaceChildren(...[
          h('div.invite-art', svgIcon('letter', 64)),
          h('p.invite-lead', INVITE_TEXT.lead),
          inv ? linkBox(inviteLink(origin(), farm.id, inv.token), { label: t('multi.invite.linkLabel') }) : null,
          h('p.invite-rules', INVITE_TEXT.rules),
          error ? h('p.modal-error', { role: 'alert' }, error) : null,
          h('div.invite-acts', make),
        // replaceChildren() writes a null as the text "null" (h() drops them)
        ].filter(Boolean));
      };
      async function makeLink() {
        if (busy) return;
        busy = true;
        paint();
        const r = await createInvite(globalThis.fetch?.bind(globalThis), farm.id, session.secret);
        busy = false;
        if (r.ok) kv.set('hh.invite', { token: r.token, expiresAt: r.expiresAt, madeAt: Date.now() });
        if (!ctx.body.isConnected) return;
        paint(r.ok ? null : INVITE_TEXT.errors[r.code] ?? INVITE_TEXT.errors.NET);
        if (r.ok) wrap.querySelector('.link-field')?.focus({ preventScroll: true });
      }
      paint();
      return { update: () => { if (!busy) paint(null, false); } };
    },
  });

  const open = () => ui.panels.open('invite');

  // the gentle nudge after the first guide step this farmer finishes (once per farm, never on a full farm)
  let nudgeT = 0;
  store.on('fx', ({ ev }) => {
    if (!ev || ev.e !== 'tutorialStep' || !ev.done || ev.pid !== store.pid || full() || kv.get('hh.inviteNudge')) return;
    kv.set('hh.inviteNudge', true);
    clearTimeout(nudgeT);
    nudgeT = setTimeout(() => {
      if (full()) return;
      ui.banner({ ribbon: t('multi.invite.title'), message: INVITE_TEXT.nudge, kind: 'card', id: 'invite-nudge', ttl: 20_000,
        actions: [{ label: t('multi.invite.title'), fn: open }, { label: t('multi.invite.later'), kind: 'paper', fn: () => {} }] });
    }, NUDGE_DELAY_MS);
  });

  function settingsRows(ctx) {
    const mine = session.secret ? personalLink(origin(), farm.id, session.secret) : null;
    return [
      h('h3', t('multi.set.sharing')),
      h('div.set-row', h('span.lbl', t('multi.invite.title')), h('div',
        full() ? h('span.help', t('multi.set.full'))
          : h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { invite: 'open' }, on: { click: () => { ctx.close(); open(); } } }, t('multi.invite.title'))),
      h('span.help', t('multi.set.inviteHelp'))),
      mine ? h('div.set-row.set-personal', h('span.lbl', t('multi.personal.label')),
        linkBox(mine, { label: t('multi.personal.label'), masked: true }),
        h('span.help', INVITE_TEXT.personal)) : null,
      // "Keep your farm safe" (ui/keep.js)
      ...(S.keep ? S.keep.keepRows(ctx) : []),
      h('div.set-row', h('span.lbl', t('multi.set.keeping')), h('span.help.set-retention', retentionText(session.ttlDays))),
      h('div.set-row', h('span.lbl', t('multi.set.farms')), h('div', h('a.btn.btn--paper.btn--small', { href: '/?home=1' }, t('multi.set.allFarms'))),
        h('span.help', t('multi.set.farmsHelp'))),
      // the Farmers: when each was last here, and a new key for one who lost theirs (ui/keep.js)
      ...(S.keep ? S.keep.farmerRows(ctx) : []),
    ].filter(Boolean);
  }

  return { open, settingsRows, full };
}
