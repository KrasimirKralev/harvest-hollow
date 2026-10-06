// Multi-farm hosted mode: never lose the key quietly (docs/agent-notes/mf-client.md "Keys"). There are no accounts:
// a farmer's key lives in this browser, and the personal link (/f/<id>#k=<secret>) is the way back on any device.
// Only in multi mode; createKeepUi returns null otherwise and nothing changes.
//
//   createKeepUi(S, opts?) -> { open(), unsaved(), paintDot(el?), keepRows(ctx), farmerRows(ctx), settingsRows(ctx),
//                               fullRows(ctx), rekeyFlow(pid), persist() } | null
//   'keep' panel (card)   "Keep your farm safe": Share to myself (the share sheet), Copy, Show a QR code, "I saved it",
//                         Later. Says whether a partner could make a new key, or that the link is the only way back.
//                         Any action asks for persistent storage (navigator.storage.persist).
//   When it shows by itself: a little after this farmer's first finished guide step (one with a deed: naming the farm,
//   the first Wheat; not the welcome card's "Let's go!", which is the first load), and on a later day (a while into
//   the visit) until "I saved it"; at most once a day, never over a big panel or another overlay, never during Golden
//   Hour (it waits for them to end). Remembered per farm in kv 'hh.keySave' = { saved, day }.
//   The dot: html[data-keep="unsaved"] until then (css/farm.css draws a quiet dot on Settings and the menus).
//   Settings > Farm: the "Keep your farm safe" row, and Farmers: each other farmer with when they were last here and
//   "Make a new key for <name>" (confirm "their old phones will be signed out" -> POST /api/f/:id/rekey -> the 'newkey'
//   card with the one-time link, Copy / Share / QR). The link made is kept per farm in kv 'hh.rejoins' until the farm
//   says it was used or it ran out, so the invite card of a full farm can show it again (fullRows).
import { h, kv, playerVars } from './dom.js';
import { farm, session, personalLink, rejoinLink, createRekey, farmStatus, TTL_DAYS } from '../net/farm.js';
import { goldenHourBp } from '../../../shared/rules/coop.js';
import { TUTORIAL } from '../../../shared/content/index.js';
import { t, tn, fmtDate } from '../i18n/index.js';
import { qrSvg } from './qr.js';
import { linkBox, copyText } from './invite.js';

const DAY_MS = 86_400_000;
/** After the first finished guide step: a breath, so Grandma's line is read first. */
export const STEP_DELAY_MS = 1500;
/** On a later day: a while into the visit, never the moment the farm opens. */
export const LATER_DELAY_MS = 90_000;
/** Busy (a big panel, Golden Hour...): look again this often, for at most RETRIES tries. */
const RETRY_MS = 5000;
const RETRIES = 240;

/** A guide step that asked for a deed (naming the farm, planting...): finishing one is the moment; the welcome card's
 *  "Let's go!" (no task), a skip or a restart is not. */
const TASK_STEPS = new Set(['start', 'fields', 'barnyard', 'together'].flatMap((k) => (TUTORIAL[k] ?? []).filter((s) => s.task).map((s) => s.id)));

const KEY_SVG = '<circle cx="16" cy="24" r="9" fill="#FFC83D" stroke="#7A4A1E" stroke-width="3"/>'
  + '<circle cx="14" cy="24" r="3" fill="#7A4A1E"/>'
  + '<path d="M25 22h17v5h-4v5h-5v-5h-8z" fill="#FFC83D" stroke="#7A4A1E" stroke-width="3" stroke-linejoin="round"/>';
function keyArt(doc = globalThis.document) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', '64');
  svg.setAttribute('height', '64');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList?.add('glyph');
  svg.innerHTML = KEY_SVG;                       // static, trusted markup from this file only
  return svg;
}

/** The local calendar day of a moment ('2026-10-05'): "once a day" is the player's own day. */
export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const canShare = (nav) => typeof nav?.share === 'function';

/** "2 days ago" for a moment in the past, in the language in effect (pure for that language). */
export function agoText(ms, now = Date.now()) {
  const d = Math.max(0, now - (Number(ms) || 0));
  const days = Math.floor(d / DAY_MS);
  if (days >= 1) return tn('keep.ago.day', days);
  const hours = Math.floor(d / 3_600_000);
  if (hours >= 1) return tn('keep.ago.hour', hours);
  const mins = Math.floor(d / 60_000);
  if (mins >= 1) return tn('keep.ago.minute', mins);
  return t('keep.ago.now');
}

/** A "Show a QR code" toggle and the place the code appears. */
function qrToggle(url, label, help) {
  const box = h('div.keep-qr');
  box.hidden = true;
  const btn = h('button.btn.btn--paper.btn--small', { type: 'button', 'aria-expanded': 'false', dataset: { keep: 'qr' } }, t('keep.qr.show'));
  btn.addEventListener('click', () => {
    const on = box.hidden;
    if (on && !box.firstChild) box.append(qrSvg(url, { label }), help ? h('p.keep-qr-help', help) : null);
    box.hidden = !on;
    if (on) box.scrollIntoView?.({ block: 'nearest' });
    btn.textContent = on ? t('keep.qr.hide') : t('keep.qr.show');
    btn.setAttribute('aria-expanded', String(on));
  });
  return { btn, box };
}

export function createKeepUi(S, opts = {}) {
  if (!farm.multi) return null;
  const { store, ui } = S;
  const nav = opts.nav ?? globalThis.navigator;
  const fetcher = opts.fetcher ?? ((...a) => globalThis.fetch(...a));
  const now = opts.now ?? (() => Date.now());
  const gameNow = opts.now ?? (() => (typeof store.now === 'function' ? store.now() : Date.now()));
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id));
  const origin = () => globalThis.location?.origin ?? '';
  const record = () => kv.get('hh.keySave') ?? {};
  const unsaved = () => !record().saved;
  const players = () => store.state?.players ?? {};
  const others = () => Object.keys(players()).filter((p) => p !== store.pid).sort();
  const nameOf = (pid) => players()[pid]?.name ?? pid;

  // ---- persistent storage: asked for at a moment the farmer acts on their key (a browser may ask them) -------------
  let persistAsked = false;
  function persist() {
    if (persistAsked) return;
    persistAsked = true;
    try {
      const st = nav?.storage;
      if (typeof st?.persist !== 'function') return;
      Promise.resolve(typeof st.persisted === 'function' ? st.persisted() : false)
        .then((done) => (done ? true : st.persist()))
        .catch(() => { /* not granted: the card says why the link matters */ });
    } catch { /* no storage manager */ }
  }

  const rejoins = () => {
    const all = kv.get('hh.rejoins') ?? {};
    const out = {};
    for (const [pid, r] of Object.entries(all)) if (r && typeof r.token === 'string' && r.expiresAt > now()) out[pid] = r;
    return out;
  };
  const forgetRejoin = (pid) => { const all = rejoins(); delete all[pid]; kv.set('hh.rejoins', all); };

  // ---- the dot -----------------------------------------------------------------------------------------------------
  function paintDot(el = globalThis.document?.documentElement) {
    if (el?.dataset) el.dataset.keep = unsaved() ? 'unsaved' : 'saved';
  }
  function markSaved() {
    kv.set('hh.keySave', { ...record(), saved: true, savedAt: now() });
    paintDot();
  }

  // ---- the card ----------------------------------------------------------------------------------------------------
  ui.panels.register('keep', {
    get title() { return t('keep.title'); },
    size: 'card',
    topics: ['players'],
    mount(body, ctx) {
      const secret = session.secret;
      const wrap = h('div.invite.keep');
      body.append(wrap);
      if (!secret) {
        wrap.append(h('div.invite-art', keyArt()), h('p.invite-lead', t('keep.nolink')),
          h('div.invite-acts', h('button.btn', { type: 'button', on: { click: () => ctx.close() } }, t('keep.newkey.done'))));
        return {};
      }
      const url = personalLink(origin(), farm.id, secret);
      const status = h('p.link-status', { role: 'status', 'aria-live': 'polite' });
      // only shown when the clipboard refuses (an http page): the link selected, to copy by hand
      const field = h('input.field.link-field', { type: 'text', readonly: true, 'aria-label': t('keep.field'), spellcheck: 'false' });
      field.hidden = true;
      const partner = others()[0];
      const acts = [];
      if (canShare(nav)) {
        acts.push(h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { keep: 'share' }, on: { click: async () => {
          persist();
          try { await nav.share({ title: t('keep.share.title'), text: t('keep.share.text'), url }); } catch { /* closed the sheet */ }
        } } }, t('keep.share')));
      }
      acts.push(h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { keep: 'copy' }, on: { click: async () => {
        persist();
        let ok = await copyText(url, { nav });
        if (!ok) {
          // no clipboard (an http page, a refusal): the link in a field, selected, for the old copy command or a finger
          field.hidden = false;
          field.value = url;
          ok = await copyText(url, { input: field, nav: {} });
        }
        status.textContent = ok ? t('keep.copied') : t('keep.copy.fail');
      } } }, t('keep.copy')));
      const qr = qrToggle(url, t('keep.qr.label'), t('keep.qr.help'));
      qr.btn.addEventListener('click', persist);
      acts.push(qr.btn);
      wrap.append(
        h('div.invite-art', keyArt()),
        h('p.invite-lead', t('keep.lead')),
        h('p.keep-why', partner ? t('keep.why.partner', { name: nameOf(partner) }) : t('keep.why.alone')),
        h('div.link-acts.keep-acts', acts),
        field,
        qr.box,
        status,
        h('p.invite-rules', t('keep.private')),
        h('div.invite-acts',
          h('button.btn', { type: 'button', dataset: { keep: 'saved' }, on: { click: () => {
            persist();
            markSaved();
            ctx.close();
            ui.toast?.(t('keep.thanks'), { kind: 'love', ms: 2600 });
          } } }, t('keep.saved')),
          h('button.btn.btn--paper', { type: 'button', dataset: { keep: 'later' }, on: { click: () => ctx.close() } }, t('keep.later'))),
      );
      return {};
    },
  });

  // ---- when it shows by itself --------------------------------------------------------------------------------------
  const due = () => { const r = record(); return !r.saved && r.day !== dayKey(now()); };
  function busy() {
    const big = ui.panels.list?.().some((p) => p.open && p.size !== 'side' && p.name !== 'keep');
    const st = store.state;
    const me = store.pid;
    const golden = st && (goldenHourBp(st, gameNow()) > 0 || Boolean(me && st.farm?.coop?.bench && Object.hasOwn(st.farm.coop.bench, me)));
    const doc = globalThis.document;
    const overlay = Boolean(doc?.body?.querySelector?.('#farm-gate, #photo-sheet, .lvl, .rosette')
      || doc?.body?.classList?.contains('hud-hidden')
      || (doc?.getElementById?.('slot-picker') && !doc.getElementById('slot-picker').hidden));
    return Boolean(big || golden || overlay);
  }
  let timer = null;
  let tries = 0;
  function soon(ms) {
    if (!due() || timer) return;
    tries = 0;
    timer = setTimer(attempt, ms);
  }
  function attempt() {
    timer = null;
    if (!due()) return;
    if (!session.secret || busy()) {
      if (++tries < RETRIES) timer = setTimer(attempt, RETRY_MS);
      return;
    }
    kv.set('hh.keySave', { ...record(), day: dayKey(now()) });
    ui.panels.open('keep');
  }
  const onWelcome = () => {
    // a later day (it showed before), or a farmer who played before this card existed: a while into the visit
    const me = players()[store.pid];
    if (due() && (record().day || (me && me.xp > 0))) soon(LATER_DELAY_MS);
  };
  store.on('fx', ({ ev } = {}) => {
    // a farmer came back with the new key this device made: that link is spent
    if (ev && ev.e === 'key' && ev.what === 'back') { forgetRejoin(ev.pid); return; }
    if (!ev || ev.e !== 'tutorialStep' || !ev.done || ev.pid !== store.pid || !TASK_STEPS.has(ev.step)) return;
    soon(STEP_DELAY_MS);
  });
  store.on('welcome', onWelcome);
  if (store.state) onWelcome();
  paintDot();

  // ---- a new key for another farmer ----------------------------------------------------------------------------------
  async function rekeyFlow(pid, ctx = null) {
    const name = nameOf(pid);
    const yes = await ui.confirm({ title: t('keep.rekey.confirm.title', { name }), lead: t('keep.rekey.confirm.lead'), glyph: 'lock',
      body: t('keep.rekey.confirm.body', { name }), ok: t('keep.rekey.confirm.ok'), cancel: t('keep.rekey.confirm.cancel') });
    if (!yes) return false;
    const r = await createRekey(fetcher, farm.id, session.secret, pid);
    if (!r.ok) {
      ui.toast?.(t(`keep.rekey.err.${r.code}`), { kind: 'info', ms: 4000 });
      return false;
    }
    kv.set('hh.rejoins', { ...rejoins(), [pid]: { token: r.token, expiresAt: r.expiresAt ?? now() + TTL_DAYS * DAY_MS, madeAt: now() } });
    ctx?.close?.();
    ui.panels.open('newkey', { pid });
    return true;
  }

  /** A rejoin link with Copy / Share and its QR code. */
  function rejoinBox(pid, r) {
    const url = rejoinLink(origin(), farm.id, r.token);
    const name = nameOf(pid);
    const box = linkBox(url, { label: t('keep.newkey.label', { name }), shareText: t('keep.newkey.share.text') });
    const qr = qrToggle(url, t('keep.newkey.qr.label', { name }), null);
    box.querySelector('.link-acts')?.append(qr.btn);
    box.append(qr.box);
    return box;
  }

  ui.panels.register('newkey', {
    title: (args) => t('keep.newkey.title', { name: nameOf(args?.pid) }),
    size: 'card',
    mount(body, ctx) {
      const pid = ctx.args?.pid;
      const r = rejoins()[pid];
      const name = nameOf(pid);
      const wrap = h('div.invite.newkey');
      body.append(wrap);
      wrap.append(h('div.invite-art', keyArt()));
      if (!r) wrap.append(h('p.invite-lead', t('keep.newkey.gone')));
      else {
        wrap.append(h('p.invite-lead', t('keep.newkey.lead', { name, days: TTL_DAYS })), rejoinBox(pid, r), h('p.invite-rules', t('keep.newkey.rules')));
      }
      wrap.append(h('div.invite-acts', h('button.btn', { type: 'button', on: { click: () => ctx.close() } }, t('keep.newkey.done'))));
      return {};
    },
  });

  /** Forget links the farm no longer waits on (used, replaced on another device, run out). */
  function syncWaiting(st) {
    if (!st || st.member !== true || !st.waiting || typeof st.waiting !== 'object') return;
    const all = rejoins();
    let changed = false;
    for (const pid of Object.keys(all)) if (!Object.hasOwn(st.waiting, pid)) { delete all[pid]; changed = true; }
    if (changed) kv.set('hh.rejoins', all);
  }

  // ---- Settings > Farm -----------------------------------------------------------------------------------------------
  function farmerRow(pid, ctx, waiting) {
    const p = players()[pid];
    const online = S.hud?.isOnline?.(pid);
    const when = online ? t('keep.farmers.online') : t('keep.farmers.seen', { ago: agoText(p?.lastSeenAt, now()) });
    const local = rejoins()[pid];
    const wait = waiting && waiting[pid];
    const until = wait?.exp ?? local?.expiresAt;
    const lines = [h('span.farmer-when', when)];
    if (wait || local) {
      const date = until ? fmtDate(until, { weekday: 'short', day: 'numeric', month: 'short' }) : '';
      lines.push(h('span.farmer-wait', t('keep.farmers.waiting', { date }),
        local ? h('button.btn.btn--paper.btn--small', { type: 'button', on: { click: () => { ctx.close?.(); ui.panels.open('newkey', { pid }); } } },
          t('keep.farmers.waiting.show')) : null));
    }
    lines.push(h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { rekey: pid }, on: { click: () => rekeyFlow(pid, ctx) } },
      t('keep.farmers.rekey', { name: nameOf(pid) })));
    return h('div.set-row.set-farmer', { dataset: { farmer: pid } },
      h('span.lbl.farmer-name', { style: playerVars(p?.color ?? '#888888') }, nameOf(pid)),
      h('div.farmer-info', lines),
      h('span.help', t('keep.farmers.rekey.help')));
  }

  /** Settings > Farm: "Keep your farm safe" (with the dot until "I saved it"). */
  function keepRows(ctx) {
    const dot = unsaved() ? h('span.keep-dot', { role: 'img', 'aria-label': t('keep.dot') }) : null;
    return [h('div.set-row.set-keep', h('span.lbl', t('keep.set.label'), dot),
      h('div.set-inline',
        h('span.keep-state', unsaved() ? t('keep.set.unsaved') : t('keep.set.saved')),
        h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { keepOpen: '' }, on: { click: () => { ctx.close?.(); ui.panels.open('keep'); } } },
          unsaved() ? t('keep.set.open') : t('keep.set.show'))),
      h('span.help', t('keep.set.help')))];
  }

  /** Settings > Farm > Farmers: each other farmer, when they were last here, and a new key for them. */
  function farmerRows(ctx) {
    const list = h('div.set-farmers');
    const paint = (waiting = null) => {
      const ids = others();
      list.replaceChildren(...(ids.length ? ids.map((pid) => farmerRow(pid, ctx, waiting))
        : [h('div.set-row', h('span.help', t('keep.farmers.alone')))]));
    };
    paint();
    if (others().length) {
      farmStatus(fetcher, farm.id, session.secret).then((st) => {
        syncWaiting(st);
        if (list.isConnected !== false) paint(st?.waiting ?? null);
      }).catch(() => { /* the rows stand without the waiting line */ });
    }
    return [h('h3', t('keep.farmers.title')), list];
  }

  const settingsRows = (ctx) => [...keepRows(ctx), ...farmerRows(ctx)];

  /** The invite card of a farm with two farmers: a way to fill a seat whose farmer lost their key. */
  function fullRows(ctx) {
    return others().map((pid) => {
      const r = rejoins()[pid];
      const name = nameOf(pid);
      if (r) return h('div.invite-rekey', h('p.invite-rules', t('keep.invite.full.waiting', { name })), rejoinBox(pid, r));
      return h('div.invite-rekey', h('p.invite-rules', t('keep.invite.full.rekey', { name })),
        h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { rekey: pid }, on: { click: () => rekeyFlow(pid, ctx) } },
          t('keep.farmers.rekey', { name })));
    });
  }

  /** What fullRows shows, as a string: the invite card repaints only when this (or its own state) changes. */
  const fullSig = () => JSON.stringify(others().map((pid) => [pid, nameOf(pid), rejoins()[pid] ?? null]));

  return { open: () => ui.panels.open('keep'), unsaved, paintDot, settingsRows, keepRows, farmerRows, fullRows, fullSig, rekeyFlow, persist };
}
