// The helper's screens, built as DOM (Harness Hollow, ui lane). Each builder takes plain data plus callbacks and returns
// an element; ui/harness/index.js decides when to (re)build which. Words come from the 'harness' catalog area.
//
//   providerLabel(id)                         'ChatGPT' | 'Claude' | 'Test helper' | the id
//   stepsEl(job)                              the four steps (reading · building · testing · ready) as an <ol>
//   changeList(changes, lang)                 what a change adds / changes / retires, with icons and numbers
//   testList(validation)                      what was tested and how it went
//   errorList(job, lang)                      what went wrong, in the player's words
//   jobCard(job, ctx)                         the current job in the panel (mine or the partner's)
//   consentCard({ onYes, onNo, busy })        the one-time question before the first change
//   providerCards(list, ctx)                  who runs the helper: sign in / out, use, model
//   signInFlow(provider, signin, ctx)         the sign-in steps (open the page, paste the code or the address)
//   historyList(history, ctx)                 the versions, with undo
//   letterCard(letter, lang)                  a letter a change brought
import { h, fmtDuration } from '../dom.js';
import { t, tn, has, fmtPct, fmtDate, list, name } from '../../i18n/index.js';
import { defOf, itemOf } from '../../../../shared/content/index.js';
import { glyph } from './glyphs.js';
import { STEPS, stepOf, stepIndex, changeRows, testRows, errorRows, errKey, jobErrLine, pickText, pasteFieldOf, noteRows } from './model.js';

/** A provider's name as the player reads it (brand names stay as they are). */
export function providerLabel(id) {
  const k = `harness.prov.${id}.name`;
  return has(k) ? t(k) : String(id ?? '');
}

/** The four steps, the current one marked (aria-current) and the done ones ticked. */
export function stepsEl(job) {
  const step = stepOf(job);
  const at = job?.state === 'ready' ? 4 : stepIndex(step);
  return h('ol.hx-steps', { 'aria-label': t('harness.job.progress') },
    STEPS.map((s, i) => h(`li.hx-step.${i < at ? 'is-done' : i === at ? 'is-now' : 'is-todo'}`,
      { 'aria-current': i === at ? 'step' : null, dataset: { step: s } },
      h('span.hx-step-dot', { 'aria-hidden': 'true' }, i < at ? glyph('check', 16) : String(i + 1)),
      h('span.hx-step-name', t(`harness.step.${s}`)))));
}

/** A signed percent (3.5 -> '+3.5%' / '+3,5 %', -2 -> '−2%'). */
export function signedPct(n) {
  const v = Number(n) || 0;
  const sign = v > 0 ? '+' : v < 0 ? '−' : '±';
  return `${sign}${fmtPct(Math.abs(v), Math.abs(v) % 1 ? 1 : 0)}`;
}

/** One fact of a change row in words. */
export function factText(f) {
  if (Number.isFinite(f.ms)) return t(f.key, { time: fmtDuration(f.ms, { trim: true }) });
  if (f.key === 'harness.fact.sell' || f.key === 'harness.fact.seed') return tn(f.key, f.n);
  return t(f.key, { n: f.n });
}

export function changeList(changes, lang) {
  const rows = changeRows(changes, lang);
  if (!rows.length) return h('p.hx-none', t('harness.ready.none'));
  return h('ul.hx-changes', rows.map((r) => h(`li.hx-change.op-${r.op}`, { dataset: { id: r.id, op: r.op } },
    h('span.hx-change-ico', { 'aria-hidden': 'true' },
      r.icon ? h('img', { src: r.icon, alt: '', width: 40, height: 40, loading: 'lazy', decoding: 'async', draggable: 'false' }) : glyph('sparkle', 32)),
    h('span.hx-change-main',
      h('span.hx-change-head',
        h('b.hx-change-name', r.name),
        h(`span.hx-op.op-${r.op}`, t(`harness.op.${r.op}`)),
        r.family ? h('span.hx-family', t(`harness.family.${r.family}`)) : null),
      r.facts.length ? h('span.hx-facts', r.facts.map((f) => h('span.hx-fact', factText(f)))) : null,
      r.op === 'retire' ? h('span.hx-facts', h('span.hx-fact', t('harness.retire.note'))) : null))));
}

function testText(r) {
  if (r.key === 'harness.test.schema' || r.key === 'harness.test.boot') return tn(r.key, r.params.n, r.params);
  if (r.key === 'harness.test.econ') return t(r.key, { coins: signedPct(r.params.coins), xp: signedPct(r.params.xp) });
  return t(r.key, r.params);
}

export function testList(validation) {
  const rows = testRows(validation);
  if (!rows.length) return null;
  return h('ul.hx-tests', rows.map((r) => h(`li.hx-test.${r.ok === true ? 'is-ok' : r.ok === false ? 'is-bad' : 'is-skip'}`, { dataset: { test: r.id } },
    h('span.hx-test-mark', { 'aria-hidden': 'true' }, glyph(r.ok === true ? 'check' : r.ok === false ? 'cross' : 'wait', 20)),
    h('span.hx-test-text', testText(r)),
    h('span.sr-only', ` (${t(r.ok === true ? 'harness.test.passed' : r.ok === false ? 'harness.test.failedWord' : 'harness.test.skippedWord')})`))));
}

/** What went wrong with a failed job: its own code first (with the provider's page when its docs name one), then the
 *  validation's findings. */
export function errorList(job, lang) {
  const items = [];
  const own = jobErrLine(job);
  if (own) items.push(t(own.key));
  const v = job?.result?.validation;
  for (const r of errorRows(v, job?.result?.changes, lang, 5, (id) => (itemOf(id) || defOf(id) ? name(id) : null))) {
    const line = t(r.key);
    const what = r.what || (r.whatKey ? t(r.whatKey) : '');
    items.push(what ? `${what}: ${line}` : line);
  }
  const uniq = [...new Set(items)];
  if (!uniq.length) uniq.push(t('harness.err.other'));
  const link = own?.link ? [' ', h('a.hx-link', { href: own.link.href, target: '_blank', rel: 'noopener noreferrer' }, t(own.link.key))] : null;
  return h('ul.hx-errors', uniq.map((s, i) => h('li', s, i === 0 ? link : null)));
}

const lastPrompt = (job) => (Array.isArray(job?.prompts) && job.prompts.length ? String(job.prompts.at(-1)?.text ?? '') : '');

/**
 * The current job in the panel. ctx: { me, nameOf(pid), lang, onCancel, onSee, onRetry, onDismiss, onKeepPlaying,
 * onSignIn(provider), busy }.
 */
export function jobCard(job, ctx) {
  const mine = job.by === ctx.me;
  const partner = ctx.nameOf(job.by);
  // a job that ended in a failure is no longer "working on": it was asked for
  const who = job.state === 'failed'
    ? (mine ? t('harness.job.askedMine') : partner ? t('harness.job.askedBy', { name: partner }) : t('harness.job.someone'))
    : mine ? t('harness.job.mine') : partner ? t('harness.job.partner', { name: partner }) : t('harness.job.someone');
  const quote = lastPrompt(job);
  // tabindex -1: the panel moves the focus here when the request box gives way to the job (ui/harness/index.js)
  const card = h(`section.hx-job.state-${job.state}`, { dataset: { job: job.id, state: job.state }, 'aria-labelledby': 'hx-job-who', tabindex: '-1' },
    h('p.hx-job-who#hx-job-who', who),
    quote ? h('blockquote.hx-quote', quote) : null);
  if (job.state === 'failed') {
    card.append(h('p.hx-job-failed', glyph('cross', 22), h('span', t('harness.job.failed'))),
      h('p.hx-sub', t('harness.job.failedWhy')), errorList(job, ctx.lang), h('p.hx-sub', t('harness.job.nothingChanged')));
    if (mine) {
      card.append(h('div.hx-actions',
        h('button.btn.btn--small', { type: 'button', dataset: { act: 'retry' }, disabled: ctx.busy || null, on: { click: () => ctx.onRetry(quote) } }, t('harness.job.retry')),
        h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'dismiss' }, on: { click: () => ctx.onDismiss(job) } }, t('harness.job.dismiss'))));
    }
    return card;
  }
  card.append(stepsEl(job));
  if (Number(job.round) > 1) card.append(h('p.hx-round', t('harness.job.round', { n: job.round })));
  const step = stepOf(job);
  if (job.state !== 'ready') {
    const now = mine && step === 'signin' ? t('harness.pill.signin') : t(`harness.pill.step.${step}`);
    card.append(h('p.hx-now', h('span.hx-spin', { 'aria-hidden': 'true' }), h('span', now)));
  }
  if (ctx.notes !== false) {
    const notes = jobNotes(job, ctx.lang);
    if (notes) card.append(notes);
  }
  if (!mine) {
    if (job.state === 'ready' && partner) card.append(h('p.hx-sub', t('harness.job.partnerReady', { name: partner })));
    // the server lets any farmer stop a job, so a job never holds the farm while the one who asked is away
    if (ctx.onCancel && job.state !== 'applying') {
      card.append(h('div.hx-actions', h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'cancel' }, disabled: ctx.busy || null,
        on: { click: () => ctx.onCancel(job) } }, t(job.state === 'ready' ? 'harness.ready.discard' : 'harness.job.stopPartner'))));
    }
    return card;
  }
  const acts = h('div.hx-actions');
  if (job.state === 'ready') {
    acts.append(h('button.btn.btn--small', { type: 'button', dataset: { act: 'see' }, on: { click: () => ctx.onSee(job) } }, glyph('sparkle', 20), t('harness.job.see')));
  } else {
    if (step === 'signin') {
      acts.append(h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { act: 'signin' }, on: { click: () => ctx.onSignIn(job.provider) } }, t('harness.prov.signIn')));
    }
    acts.append(h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { act: 'play' }, on: { click: () => ctx.onKeepPlaying() } }, t('harness.job.keepPlaying')));
    if (job.state !== 'applying') {
      acts.append(h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'cancel' }, disabled: ctx.busy || null, on: { click: () => ctx.onCancel(job) } }, t('harness.job.cancel')));
    }
  }
  card.append(acts);
  return card;
}

/** The helper's last few progress notes (plain text from the server), or null. */
export function jobNotes(job, lang = 'en') {
  if (!job || job.state === 'ready' || job.state === 'failed') return null;
  const rows = noteRows(job, lang);
  if (!rows.length) return null;
  return h('ul.hx-notes', { 'aria-label': t('harness.job.notes') }, rows.map((r) => h('li', r.key ? t(r.key) : r.text)));
}

export function consentCard({ onYes, onNo, busy = false, error = null, privacy = null }) {
  return h('section.hx-consent', { role: 'group', 'aria-labelledby': 'hx-consent-title', dataset: { consent: 'ask' }, tabindex: '-1' },
    h('h3#hx-consent-title', t('harness.consent.title')),
    h('p.hx-consent-ask', h('b', t('harness.consent.ask'))),
    h('p', t('harness.consent.what')),
    h('p', t('harness.consent.keep')),
    error ? h('p.hx-error', { role: 'alert' }, t(error)) : null,
    h('div.hx-actions',
      h('button.btn.btn--small', { type: 'button', dataset: { consent: 'yes' }, disabled: busy || null, on: { click: onYes } }, t('harness.consent.yes')),
      h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { consent: 'no' }, disabled: busy || null, on: { click: onNo } }, t('harness.consent.no'))),
    h('p.hx-sub', t('harness.consent.later'),
      privacy ? [' ', h('a.hx-link', { href: privacy, target: '_blank', rel: 'noopener noreferrer' }, t('harness.set.privacy'))] : null));
}

/** A sign-in URL we may show as a link: https, or a path of this site (the mock provider's page). */
export function safeUrl(u) {
  const s = String(u ?? '');
  if (/^\/(?!\/)[^\s]*$/.test(s)) return s;
  try {
    const x = new URL(s);
    return x.protocol === 'https:' || (x.protocol === 'http:' && /^(127\.0\.0\.1|localhost)$/.test(x.hostname)) ? x.href : null;
  } catch {
    return null;
  }
}

/**
 * The sign-in steps of one provider. ctx: { onContinue(provider, value, field), onCancel(provider), onRestart(provider),
 * onCopy(url), busy, error }.
 */
export function signInFlow(provider, signin, ctx) {
  const name = providerLabel(provider);
  const box = h('section.hx-signin', { dataset: { signin: provider }, 'aria-labelledby': `hx-signin-${provider}` },
    h('h3', { id: `hx-signin-${provider}` }, t('harness.signin.title', { provider: name })));
  const state = signin?.state ?? 'pending';
  if (state === 'signed_in') {
    box.append(h('p.hx-ok', { role: 'status' }, glyph('check', 22), h('span', t('harness.signin.done', { provider: name }))));
    return box;
  }
  const err = signin?.error?.code ? errKey(signin.error.code) : ctx.error;
  const url = signin?.step?.kind === 'open_url' ? safeUrl(signin.step.url) : null;
  const field = pasteFieldOf(provider, signin);
  if (!signin || (!url && signin.step?.kind !== 'paste' && state !== 'error')) {
    box.append(h('p.hx-wait', { role: 'status' }, h('span.hx-spin', { 'aria-hidden': 'true' }), h('span', t('harness.signin.starting'))));
  }
  if (url) {
    box.append(h('ol.hx-signin-steps',
      h('li', h('p', t('harness.signin.step1')), h('div.hx-actions',
        h('a.btn.btn--sky.btn--small', { href: url, target: '_blank', rel: 'noopener noreferrer', dataset: { signinOpen: provider } }, t('harness.signin.open')),
        h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'copy' }, on: { click: () => ctx.onCopy(url) } }, t('harness.signin.copyLink')))),
      field ? h('li', pasteForm(provider, field, ctx)) : null));
  } else if (signin?.step?.kind === 'paste') {
    box.append(pasteForm(provider, field, ctx));
  }
  if (field === 'redirect_url' && url) box.append(h('p.hx-sub', t('harness.signin.url.auto')));
  if (state === 'pending' && url && !field) box.append(h('p.hx-wait', { role: 'status' }, h('span.hx-spin', { 'aria-hidden': 'true' }), h('span', t('harness.signin.waiting'))));
  if (err) box.append(h('p.hx-error', { role: 'alert' }, t(err)));
  const priv = `harness.signin.${provider}.private`;
  if (has(priv)) box.append(h('p.hx-sub.hx-private', t(priv)));
  box.append(h('div.hx-actions',
    state === 'error' ? h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { act: 'restart' }, on: { click: () => ctx.onRestart(provider) } }, t('harness.signin.again')) : null,
    h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'cancelSignin' }, on: { click: () => ctx.onCancel(provider) } }, t('harness.signin.cancel'))));
  return box;
}

function pasteForm(provider, field, ctx) {
  const id = `hx-paste-${provider}`;
  const isUrl = field === 'redirect_url';
  const input = h('input.field.hx-paste', { id, type: isUrl ? 'url' : 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    inputmode: isUrl ? 'url' : 'text', dataset: { field } });
  const go = () => {
    const v = String(input.value ?? '').trim();
    if (!v) { input.focus(); return; }
    ctx.onContinue(provider, v, field);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  return h('div.hx-paste-row',
    h('p', t(isUrl ? 'harness.signin.url.step' : 'harness.signin.code.step')),
    h('label.hx-label', { for: id }, t(isUrl ? 'harness.signin.url.label' : 'harness.signin.code.label')),
    h('div.hx-inline', input,
      h('button.btn.btn--small', { type: 'button', dataset: { act: 'continue' }, disabled: ctx.busy || null, on: { click: go } }, t('harness.signin.send'))));
}

/**
 * Who runs the helper. ctx: { current, signins: { [id]: SignInState }, models: { [id]: [{ id, label }] }, model,
 * onUse(id), onSignIn(id), onSignOut(id), onModel(id, model), flow(id) -> Element | null, busy }.
 */
export function providerCards(providers, ctx) {
  if (!providers.length) return h('p.hx-none', t('harness.prov.none'));
  return h('ul.hx-providers', providers.map((p) => h('li.hx-slot', providerCard(p, ctx))));
}

/** One provider's card (a div: the list item around it is the caller's, so each card can redraw on its own). */
export function providerCard(p, ctx) {
  const using = p.id === ctx.current && p.available !== false && p.signedIn;
  const status = p.available === false
    ? h('span.hx-status.is-off', `${t('harness.prov.unavailable')}: ${t(errKey(p.reason))}`)
    : p.signedIn
      ? h('span.hx-status.is-on', glyph('check', 18), p.account?.label ? t('harness.prov.signedIn', { account: p.account.label }) : t('harness.prov.signedInPlain'))
      : h('span.hx-status', t('harness.prov.signedOut'));
  const li = h(`div.hx-provider${using ? '.is-current' : ''}${p.available === false ? '.is-off' : ''}`, { dataset: { provider: p.id } },
    h('div.hx-provider-head', h('b.hx-provider-name', providerLabel(p.id)), using ? h('span.hx-op.op-add', t('harness.prov.using')) : null),
    has(`harness.prov.${p.id}.desc`) ? h('p.hx-sub', t(`harness.prov.${p.id}.desc`)) : null,
    status);
  const flow = ctx.flow(p.id);
  if (flow) { li.append(flow); return li; }
  const acts = h('div.hx-actions');
  if (p.available !== false && p.signedIn && !using) acts.append(h('button.btn.btn--small', { type: 'button', dataset: { act: 'use' }, on: { click: () => ctx.onUse(p.id) } }, t('harness.prov.use')));
  if (p.available !== false && !p.signedIn) acts.append(h('button.btn.btn--sky.btn--small', { type: 'button', dataset: { act: 'signin' }, disabled: ctx.busy || null, on: { click: () => ctx.onSignIn(p.id) } }, t('harness.prov.signIn')));
  // Claude Code's own sign-in methods are all offered, never hidden (provider rules): its default first, then the rest
  const methods = p.id === 'claude' && p.available !== false && !p.signedIn ? h('details.hx-methods', h('summary', t('harness.prov.claude.other')),
    h('div.hx-actions', ['console', 'sso'].map((m) => h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'signin', method: m }, disabled: ctx.busy || null,
      on: { click: () => ctx.onSignIn(p.id, m) } }, t(`harness.prov.claude.${m}`))))) : null;
  if (p.signedIn) acts.append(h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'signout' }, disabled: ctx.busy || null, on: { click: () => ctx.onSignOut(p.id) } }, t('harness.prov.signOut')));
  if (acts.children.length) li.append(acts);
  if (methods) li.append(methods);
  const models = ctx.models[p.id] ?? (Array.isArray(p.models) ? p.models : []);
  if (using && models.length > 1) {
    const id = `hx-model-${p.id}`;
    const sel = h('select.field.hx-model', { id, on: { change: (e) => ctx.onModel(p.id, e.target.value || null) } },
      h('option', { value: '' }, t('harness.prov.modelDefault')),
      models.map((m) => h('option', { value: String(m.id), selected: String(m.id) === ctx.model || null }, String(m.label ?? m.id))));
    li.append(h('div.hx-model-row', h('label.hx-label', { for: id }, t('harness.prov.model')), sel));
  }
  return li;
}

const KIND_KEYS = { apply: 'harness.hist.kind.apply', undo: 'harness.hist.kind.undo', suspend: 'harness.hist.kind.suspend' };

/** The versions, newest first. ctx: { lang, nameOf(pid), onUndo(to | null, n | null), busy }. */
export function historyList(history, ctx) {
  const versions = Array.isArray(history?.versions) ? history.versions : [];
  if (!versions.length) return h('p.hx-none', t('harness.hist.empty'));
  const active = Number.isInteger(history.active) ? history.active : null;
  const prev = active === null ? null : versions.filter((v) => v.n < active).sort((a, b) => b.n - a.n)[0] ?? null;
  const wrap = h('div.hx-history');
  if (active !== null && active > 0) {
    wrap.append(h('div.hx-actions', h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'undoLast' }, disabled: ctx.busy || null,
      on: { click: () => ctx.onUndo(null, prev ? prev.n : null) } }, glyph('back', 20), t('harness.hist.undoLast'))));
  }
  wrap.append(h('ol.hx-versions', versions.map((v) => {
    const isActive = v.n === active || v.state === 'active';
    const who = ctx.nameOf(v.by) ?? '';
    const when = Number.isFinite(v.at) ? fmtDate(v.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    const chips = changeRows(v.changes, ctx.lang);
    const shown = chips.slice(0, 4);
    const li = h(`li.hx-version${isActive ? '.is-active' : ''}`, { dataset: { n: String(v.n) } },
      h('div.hx-version-head',
        h('b', t('harness.hist.version', { n: v.n })),
        KIND_KEYS[v.kind] ? h(`span.hx-kind.kind-${v.kind}`, t(KIND_KEYS[v.kind])) : null,
        isActive ? h('span.hx-op.op-add', t('harness.hist.active')) : null),
      pickText(v.title, ctx.lang) ? h('p.hx-version-title', pickText(v.title, ctx.lang)) : null,
      who || when ? h('p.hx-sub', who && when ? t('harness.hist.byWhen', { name: who, when }) : who || when) : null,
      v.prompt ? h('p.hx-asked', t('harness.hist.asked', { prompt: String(v.prompt).slice(0, 160) })) : null,
      shown.length ? h('ul.hx-chips', shown.map((c) => h(`li.hx-chip.op-${c.op}`, c.icon ? h('img', { src: c.icon, alt: '', width: 20, height: 20, loading: 'lazy' }) : null, c.name)),
        chips.length > shown.length ? h('li.hx-chip.more', tn('harness.hist.more', chips.length - shown.length)) : null) : null);
    if (!isActive && v.kind !== 'suspend' && active !== null) {
      li.append(h('div.hx-actions', h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'goBack' }, disabled: ctx.busy || null,
        on: { click: () => ctx.onUndo(v.n, v.n) } }, t('harness.hist.goBack'))));
    }
    return li;
  })));
  return wrap;
}

/** A letter from the overlay's text.letters ({ id, from, art, en: { title, body }, bg: { … } }). */
export function letterCard(letter, lang, fromName) {
  const body = pickText({ en: letter?.en?.body, bg: letter?.bg?.body }, lang);
  return h('article.hx-letter', { dataset: { letter: String(letter?.id ?? '') } },
    fromName ? h('p.hx-letter-from', t('harness.letter.from', { name: fromName })) : null,
    ...String(body).split(/\n{2,}/).map((para) => h('p', para)));
}

/** "a, b and c" for the toasts (the language's list). */
export const joinNames = (names) => list(names);
