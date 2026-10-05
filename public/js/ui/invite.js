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
//   INVITE_TEXT                                       the words (tests)
import { h, kv, svgIcon, ensureStylesheet } from './dom.js';
import { farm, session, createInvite, inviteLink, personalLink, TTL_DAYS } from '../net/farm.js';

const DAY_MS = 86_400_000;
const NUDGE_DELAY_MS = 2500;

export const INVITE_TEXT = Object.freeze({
  lead: 'Farming is better with two. Send this link to one friend: whoever opens it first becomes the second farmer and plays here with you, live.',
  rules: `The link works once, for ${TTL_DAYS} days. Making a new link turns the old one off.`,
  full: 'Your farm has two farmers. That is everyone a farm can have, so there is nothing to invite to.',
  personal: 'Opens this farm as you on any device. Keep it private: it is your key.',
  retention: `This farm is kept while you play; after ${TTL_DAYS} days without a visit it is deleted.`,
  nudge: 'Farming is better with two. Send a friend a link and they can farm here with you, live.',
  share: 'Come and farm with me in Harvest Hollow!',
  errors: Object.freeze({
    FULL: 'Your farm already has two farmers.',
    AUTH: 'This device cannot make an invite for this farm. Open your personal farm link first.',
    RATE: 'Lots of invites just now. Try again in a minute.',
    NET: 'The farm did not answer. Try again in a moment.',
  }),
});

/** Copy to the clipboard; on an http page (no clipboard API) select the field and use the old command. */
export async function copyText(text, { input = null, nav = globalThis.navigator, doc = globalThis.document } = {}) {
  try {
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') { await nav.clipboard.writeText(text); return true; }
  } catch { /* denied: try the old way */ }
  try {
    if (input) { input.focus(); input.select(); input.setSelectionRange?.(0, text.length); }
    return Boolean(doc?.execCommand?.('copy'));
  } catch { return false; }
}

/** The Settings line about deleting a farm nobody visits (the server's HH_FARM_TTL_DAYS, 7 by default). Pure. */
export const retentionText = (days = TTL_DAYS) => (days === TTL_DAYS ? INVITE_TEXT.retention
  : `This farm is kept while you play; after ${days} day${days === 1 ? '' : 's'} without a visit it is deleted.`);

const canShare = (nav = globalThis.navigator) => typeof nav?.share === 'function';

async function share(url, nav = globalThis.navigator) {
  try {
    await nav.share({ title: 'Harvest Hollow', text: INVITE_TEXT.share, url });
    return true;
  } catch { return false; }   // the player closed the sheet: nothing to say
}

/** A link field with Copy and (on a phone) Share, and a status line. `masked`: shown only after "Show". */
function linkBox(url, { label, masked = false, shareText = true } = {}) {
  const status = h('p.link-status', { role: 'status', 'aria-live': 'polite' });
  const field = h('input.field.link-field', { type: 'text', readonly: true, value: masked ? '' : url, 'aria-label': label, spellcheck: 'false' });
  if (masked) field.placeholder = '•••••••••••• (hidden)';
  field.addEventListener('focus', () => { if (field.value) field.select(); });
  const copy = h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { act: 'copy' }, on: { click: async () => {
    const ok = await copyText(url, { input: field.value ? field : null });
    status.textContent = ok ? 'Copied. Paste it in a message.' : 'Press and hold the link to copy it.';
    if (!ok && !field.value) { field.value = url; field.select(); }
  } } }, 'Copy');
  const acts = [copy];
  if (shareText && canShare()) {
    acts.push(h('button.btn.btn--small', { type: 'button', dataset: { act: 'share' }, on: { click: () => share(url) } }, 'Share…'));
  }
  if (masked) {
    const show = h('button.btn.btn--paper.btn--small', { type: 'button', 'aria-pressed': 'false', dataset: { act: 'show' }, on: { click: () => {
      const on = !field.value;
      field.value = on ? url : '';
      show.textContent = on ? 'Hide' : 'Show';
      show.setAttribute('aria-pressed', String(on));
    } } }, 'Show');
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
    title: 'Invite a friend',
    size: 'card',
    topics: ['players'],
    mount(body, ctx) {
      const wrap = h('div.invite');
      body.append(wrap);
      let busy = false;
      const paint = (error = null) => {
        if (full()) {
          wrap.replaceChildren(h('div.invite-art', svgIcon('heart', 64)), h('p.invite-lead', INVITE_TEXT.full),
            h('div.invite-acts', h('button.btn', { type: 'button', on: { click: () => ctx.close() } }, 'Back to the farm')));
          return;
        }
        const inv = saved();
        const make = h(`button.btn${inv ? '.btn--paper.btn--small' : ''}`, { type: 'button', dataset: { act: 'make' }, disabled: busy || null,
          on: { click: () => makeLink() } }, busy ? 'Making a link…' : inv ? 'Make a new link' : 'Make an invite link');
        wrap.replaceChildren(...[
          h('div.invite-art', svgIcon('letter', 64)),
          h('p.invite-lead', INVITE_TEXT.lead),
          inv ? linkBox(inviteLink(origin(), farm.id, inv.token), { label: 'Invite link for a friend' }) : null,
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
      return { update: () => { if (!busy) paint(); } };
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
      ui.banner({ ribbon: 'Invite a friend', message: INVITE_TEXT.nudge, kind: 'card', id: 'invite-nudge', ttl: 20_000,
        actions: [{ label: 'Invite a friend', fn: open }, { label: 'Later', kind: 'paper', fn: () => {} }] });
    }, NUDGE_DELAY_MS);
  });

  function settingsRows(ctx) {
    const mine = session.secret ? personalLink(origin(), farm.id, session.secret) : null;
    return [
      h('h3', 'Sharing this farm'),
      h('div.set-row', h('span.lbl', 'Invite a friend'), h('div',
        full() ? h('span.help', 'Two farmers already: the farm is full.')
          : h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { invite: 'open' }, on: { click: () => { ctx.close(); open(); } } }, 'Invite a friend')),
      h('span.help', 'A one-time link: your friend opens it and plays here with you.')),
      mine ? h('div.set-row.set-personal', h('span.lbl', 'Your personal farm link'),
        linkBox(mine, { label: 'Your personal farm link', masked: true }),
        h('span.help', INVITE_TEXT.personal)) : null,
      h('div.set-row', h('span.lbl', 'Keeping the farm'), h('span.help.set-retention', retentionText(session.ttlDays))),
      h('div.set-row', h('span.lbl', 'Your farms'), h('div', h('a.btn.btn--paper.btn--small', { href: '/?home=1' }, 'All farms on this device')),
        h('span.help', 'Start another farm, or open one you played on this device.')),
    ].filter(Boolean);
  }

  return { open, settingsRows, full };
}
