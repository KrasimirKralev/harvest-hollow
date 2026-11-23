// The helper's screens, built as DOM (Harness Hollow, ui lane). Each builder takes plain data plus callbacks and returns
// an element; ui/harness/index.js decides when to (re)build which. Words come from the 'harness' catalog area.
//
//   providerLabel(id)                         'ChatGPT' | 'Claude' | 'Test helper' | the id
//   stepsEl(job)                              the four steps (reading · building · testing · ready) as an <ol>
//   changeList(changes, lang, ctx?)           what a change adds / changes / retires, with icons and facts (release
//                                             1.0 H3: every row kind; ctx { level, season } for "From level 33 (your
//                                             farm is 21)" and the season)
//   testList(validation)                      what was tested and how it went
//   testFold(validation)                      the same, folded to one "Tested on a copy of your farm" line that opens
//                                             (open by itself when a test failed)
//   errorList(job, lang)                      what went wrong, in the player's words
//   jobCard(job, ctx)                         the current job in the panel (mine or the partner's)
//   consentCard({ onYes, onNo, busy })        the one-time question before the first change
//   providerCards(list, ctx)                  who runs the helper: sign in / out, use, model
//   signInFlow(provider, signin, ctx)         the sign-in steps (open the page, paste the code or the address)
//   historyList(history, ctx)                 the versions, with undo
//   letterCard(letter, lang)                  a letter a change brought
import { h, fmtDuration } from '../dom.js';
import { t, tn, has, fmtPct, fmtDate, list, name, lang as curLang, N } from '../../i18n/index.js';
import { assetUrl } from '../../net/asset-base.js';
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

/** A name inside a sentence: Bulgarian lower-cases it ("добави лунен пъпеш"), English keeps its Title Case. */
const inSentence = (s) => (curLang() === 'bg' && s ? s[0].toLocaleLowerCase('bg') + s.slice(1) : s);
const dur = (ms) => fmtDuration(ms, { trim: true });

/** One fact of a change row in words. */
export function factText(f) {
  switch (f.key) {
    case 'harness.fact.sell': case 'harness.fact.seed': case 'harness.fact.cost': return tn(f.key, f.n);
    case 'harness.fact.gives': return tn(f.key, f.n, { product: inSentence(f.product), time: dur(f.ms) });
    case 'harness.fact.growFromTo': return t(f.key, { from: dur(f.from), to: dur(f.to) });
    case 'harness.fact.later': return t(f.key, f.params);
    case 'harness.fact.workshop': return t(f.key, { building: N(f.building) });
    case 'harness.fact.inputs': return t(f.key, { inputs: list(f.inputs.map((x) => `${inSentence(x.name)} ×${x.n}`)) });
    case 'harness.fact.season':
      return f.now ? t(f.key, { season: t(`harness.season.${f.season}`), now: t(`harness.season.${f.now}`) })
        : t('harness.fact.seasonOnly', { season: t(`harness.season.${f.season}`) });
    case 'harness.fact.seasonNow': return t(f.key, { season: t(`harness.season.${f.season}`) });
    case 'harness.letter.row': {
      let who = f.from;
      try { who = name(f.from); } catch { /* not a content id */ }
      if (!who || who === f.from) who = String(f.from).replace(/^./, (c) => c.toUpperCase());
      return t(f.key, { name: who });
    }
    default:
      if (Number.isFinite(f.ms)) return t(f.key, { time: dur(f.ms) });
      return t(f.key, { n: f.n });
  }
}

/** The headline of a row that is not a thing (a speed knob, the sky, the music), else its name. */
function rowTitle(r) {
  const x = r.title;
  if (!x) return r.name;
  if (r.kind === 'tuning') return t(x.key, { pct: fmtPct(x.pct) });
  if (r.kind === 'sky') return t(x.key, { sky: t(`harness.sky.${x.sky}`) });
  if (r.kind === 'music') return x.tracks ? t(x.key, { tracks: list(x.tracks) }) : t(x.key);
  return r.name;
}
const KIND_GLYPH = { tuning: 'speed', tuned: 'speed', sky: 'sky', music: 'music', letter: 'letter' };

/** A row's picture: the thing's own icon (a base thing's through assetUrl: option 2), else a glyph of its kind. */
function rowIcon(r) {
  if (r.icon) {
    // a game icon is a static file (option 2: through assetUrl); a mod's icon is this farm's own and stays here
    const isStatic = r.icon.startsWith('/assets/'); // asset-ok: a comparison; the URL itself goes through assetUrl below
    const img = h('img', { alt: '', width: 40, height: 40, loading: 'lazy', decoding: 'async', draggable: 'false' });
    if (isStatic) img.setAttribute('crossorigin', 'anonymous');
    img.setAttribute('src', isStatic ? assetUrl(r.icon) : r.icon);
    return img;
  }
  return glyph(KIND_GLYPH[r.kind] ?? 'sparkle', 32);
}

export function changeList(changes, lang, ctx = {}) {
  const rows = changeRows(changes, lang, ctx);
  if (!rows.length) return h('p.hx-none', t('harness.ready.none'));
  return h('ul.hx-changes', rows.map((r) => h(`li.hx-change.op-${r.op}.kind-${r.kind}${r.warn ? '.is-later' : ''}`, { dataset: { id: r.id, op: r.op, kind: r.kind } },
    h('span.hx-change-ico', { 'aria-hidden': 'true' }, rowIcon(r)),
    h('span.hx-change-main',
      h('span.hx-change-head',
        h('b.hx-change-name', rowTitle(r)),
        h(`span.hx-op.op-${r.op}`, t(`harness.op.${r.op}`)),
        r.family && r.kind === 'thing' ? h('span.hx-family', t(`harness.family.${r.family}`)) : null),
      r.facts.length ? h('span.hx-facts', r.facts.map((f) => h(`span.hx-fact${f.warn ? '.is-warn' : ''}`, factText(f)))) : null,
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

/** The tests folded to one line (harvey#8, astra#5: the change comes first); a failed test keeps the list open. */
export function testFold(validation) {
  const rows = testRows(validation);
  if (!rows.length) return null;
  const bad = rows.some((r) => r.ok === false);
  return h(`details.hx-tested${bad ? '.is-bad' : ''}`, { open: bad || null, dataset: { tested: bad ? 'bad' : 'ok' } },
    h('summary.hx-tested-line', h('span.hx-test-mark', { 'aria-hidden': 'true' }, glyph(bad ? 'cross' : 'check', 20)),
      h('span', t(bad ? 'harness.test.foldedBad' : 'harness.test.folded'))),
    testList(validation));
}

/** What went wrong with a failed job: its own code first (with the provider's page when its docs name one), then the
 *  validation's findings. */
export function errorList(job, lang) {
  return errorItems(job, lang);
}

/** The same list folded behind "What went wrong" (H1, harvey#10: Harvey's own words come first, the codes after). */
export function errorFold(job, lang) {
  return h('details.hx-what', { dataset: { what: 'wrong' } }, h('summary', t('harness.job.whatWrong')), errorItems(job, lang));
}

function errorItems(job, lang) {
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

/** Harvey's own words for a job (its summary, or the answer to the last follow-up) in the language, or ''. */
export const sayOf = (job, lang) => pickText(job?.result?.answer ?? job?.result?.summary, lang);

/**
 * A failed job's summary tells the change the agent meant to make unless it says "possible": false (then it is his
 * answer): the heading for it, so a failure never reads as if the farm had the thing.
 */
export const failSaidKey = (job) => (job?.result?.answer || job?.result?.summary?.possible === false ? 'harness.answer.says' : 'harness.answer.planned');

/**
 * The wish as the farmer asked it. A long one (a dictated wish runs long) shows its first three lines and a "Show all"
 * toggle, so the card's buttons stay near (QA r1 H-18: a 1000-character wish put "See the changes" two screens down).
 */
export function quoteEl(text) {
  const s = String(text ?? '');
  const q = h('blockquote.hx-quote', s);
  if (s.length <= 140 && s.split('\n').length <= 3) return q;
  q.classList.add('is-clamped');
  q.id = `hx-quote-${Math.random().toString(36).slice(2, 8)}`;
  const more = h('button.btn.btn--paper.btn--small.hx-quote-more', { type: 'button', 'aria-expanded': 'false', 'aria-controls': q.id, dataset: { act: 'quoteMore' } }, t('harness.quote.more'));
  more.addEventListener('click', () => {
    const open = q.classList.toggle('is-clamped') === false;
    more.setAttribute('aria-expanded', String(open));
    more.textContent = t(open ? 'harness.quote.less' : 'harness.quote.more');
  });
  return h('div.hx-quote-wrap', q, more);
}

/**
 * The current job in the panel. ctx: { me, nameOf(pid), lang, onCancel, onSee, onRetry, onDismiss, onKeepPlaying,
 * onSignIn(provider), busy }.
 */
export function jobCard(job, ctx) {
  const mine = job.by === ctx.me;
  const partner = ctx.nameOf(job.by);
  // a job that ended in a failure is no longer "working on": it was asked for
  // a job that ended was asked for; a ready one waits (harvey#11: never "working on" once it is ready)
  const who = job.state === 'failed' || job.state === 'answered'
    ? (mine ? t('harness.job.askedMine') : partner ? t('harness.job.askedBy', { name: partner }) : t('harness.job.someone'))
    : job.state === 'ready'
      ? (mine ? t('harness.job.readyMine') : partner ? t('harness.job.readyPartner', { name: partner }) : t('harness.job.someone'))
      : mine ? t('harness.job.mine') : partner ? t('harness.job.partner', { name: partner }) : t('harness.job.someone');
  const quote = lastPrompt(job);
  // tabindex -1: the panel moves the focus here when the request box gives way to the job (ui/harness/index.js)
  const card = h(`section.hx-job.state-${job.state}`, { dataset: { job: job.id, state: job.state }, 'aria-labelledby': 'hx-job-who', tabindex: '-1' },
    h('p.hx-job-who#hx-job-who', who),
    quote ? quoteEl(quote) : null);
  if (job.state === 'answered') {
    // H1: Harvey's answer, not a failure: his words, then what to do next
    const said = sayOf(job, ctx.lang) || t('harness.answer.nothing');
    card.append(h('p.hx-job-answered', glyph('helper', 22), h('span', t('harness.job.answered'))), h('p.hx-answer-text', said));
    if (mine) {
      card.append(h('div.hx-actions',
        h('button.btn.btn--small', { type: 'button', dataset: { act: 'change' }, on: { click: () => ctx.onChange?.(quote) } }, t('harness.job.change')),
        h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'dismiss' }, on: { click: () => ctx.onDismiss(job) } }, t('harness.job.dismiss'))));
    }
    return card;
  }
  if (job.state === 'failed') {
    // H1 (harvey#10): what Harvey said first; the primary action changes the wish (the same wish fails the same way)
    const said = sayOf(job, ctx.lang);
    card.append(...[h('p.hx-job-failed', glyph('cross', 22), h('span', t('harness.job.failed'))),
      said ? h('p.hx-h.hx-said-h', t(failSaidKey(job))) : null, said ? h('p.hx-answer-text', said) : null, errorFold(job, ctx.lang),
      h('p.hx-sub', t('harness.job.nothingChanged'))].filter(Boolean));
    if (mine) {
      card.append(h('div.hx-actions',
        h('button.btn.btn--small', { type: 'button', dataset: { act: 'change' }, on: { click: () => ctx.onChange?.(quote) } }, t('harness.job.change')),
        h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'retry' }, disabled: ctx.busy || null, on: { click: () => ctx.onRetry(quote) } }, t('harness.job.retry'))));
    }
    return card;
  }
  card.append(stepsEl(job));
  if (Number(job.round) > 1) card.append(h('p.hx-round', t('harness.job.round', { n: job.round })));
  const step = stepOf(job);
  if (job.state !== 'ready') {
    const now = mine && step === 'signin' ? t('harness.pill.signin') : t(`harness.pill.step.${step}`);
    card.append(h('p.hx-now', h('span.hx-spin', { 'aria-hidden': 'true' }), h('span', now)));
    // harvey#13: how long so far, and how long it usually takes
    if (mine && Number.isFinite(job.startedAt) && Date.now() - job.startedAt < 6 * 3_600_000) {
      card.append(h('p.hx-sub.hx-elapsed', t('harness.pill.elapsed', { time: fmtDuration(Math.max(0, Date.now() - job.startedAt), { trim: true }) })));
    }
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
    // harvey#16: opt-in, default off: the two answers weigh the same (one paper style, one size; keeping them first)
    h('div.hx-actions.hx-consent-acts',
      h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { consent: 'no' }, disabled: busy || null, on: { click: onNo } }, t('harness.consent.no')),
      h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { consent: 'yes' }, disabled: busy || null, on: { click: onYes } }, t('harness.consent.yes'))),
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
    h('h3', { id: `hx-signin-${provider}` }, t('harness.signin.title', { provider: name })),
    // why this sign-in is here (QA r2 H2-C1: "Your sign-in ran out…"), at the top of the card the tab scrolls to
    ctx.note?.key ? h(`p.hx-flash.hx-signin-note.tone-${ctx.note.tone ?? 'info'}`, { role: 'status' }, t(ctx.note.key, ctx.note.params ?? {})) : null);
  const state = signin?.state ?? 'pending';
  if (state === 'signed_in') {
    box.append(h('p.hx-ok', { role: 'status' }, glyph('check', 22), h('span', t('harness.signin.done', { provider: name }))));
    return box;
  }
  // a provider that cannot be reached is named, with what to do (QA r1 H-10: never "The helper is not available")
  const code = signin?.error?.code;
  const err = code === 'UNAVAILABLE' ? ['harness.signin.unavailable', { provider: name }] : code ? [errKey(code)] : ctx.error ? [ctx.error] : null;
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
  if (err) box.append(h('p.hx-error', { role: 'alert' }, t(...err)));
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
      // a mouse press keeps the focus in the field (the panel frame's typing room would shrink under the pointer: QA r1)
      h('button.btn.btn--small', { type: 'button', dataset: { act: 'continue' }, disabled: ctx.busy || null,
        on: { mousedown: (e) => { if (e.button === 0) e.preventDefault(); }, click: go } }, t('harness.signin.send'))));
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
    has(`harness.prov.${p.id}.plan`) ? h('p.hx-plan', t(`harness.prov.${p.id}.plan`)) : null,
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
      h('option', { value: '' }, ((d) => (d ? t('harness.prov.modelPicked', { model: String(d.label ?? d.id) }) : t('harness.prov.modelDefault')))(
        models.find((m) => String(m.id) === ctx.modelDefault?.[p.id]))),
      models.map((m) => h('option', { value: String(m.id), selected: String(m.id) === ctx.model || null }, String(m.label ?? m.id))));
    li.append(h('div.hx-model-row', h('label.hx-label', { for: id }, t('harness.prov.model')), sel));
  }
  return li;
}

const KIND_KEYS = { apply: 'harness.hist.kind.apply', undo: 'harness.hist.kind.undo', revive: 'harness.hist.kind.revive',
  rebuild: 'harness.hist.kind.rebuild', suspend: 'harness.hist.kind.suspend' };
const LEFT_OUT = ['palette', 'tips'];
/** Why a version offers no "Go back to this" (the server's `go.code`, QA r4 H4-07). */
const GO_WHY = { NO_CHANGE: 'harness.hist.sameAsNow', DAMAGED: 'harness.hist.cannotGo.DAMAGED', INVALID: 'harness.hist.cannotGo.INVALID' };

/** Versions the game made, not a farmer (a rebuild for a new game version, a pause): nobody asked for them. */
const GAME_MADE = new Set(['rebuild', 'suspend']);
/** A wish at most `max` characters long, cut on a character (never half an emoji), trimmed, and "…" when cut (QA r2 H2-09). */
export function shortWish(text, max = 160) {
  const chars = Array.from(String(text ?? ''));
  if (chars.length <= max) return chars.join('');
  return `${chars.slice(0, max).join('').trimEnd()}…`;
}

/**
 * Where "Undo the last change" goes from the active version: the server's word (`history.undo`), else the same walk on the
 * list: a rebuild or a pause is see-through, the last change is the farmer's own below it (QA r2 H2-01). Returns
 * { to, last, revive } (n numbers) or null.
 */
export function undoPlan(history) {
  const versions = Array.isArray(history?.versions) ? history.versions : [];
  const active = Number.isInteger(history?.active) ? history.active : null;
  if (active === null || active <= 0) return null;
  const u = history.undo;
  if (u && typeof u === 'object') {
    // the server's word; `to: null` = nothing to undo or bring back (QA r3 H3-05: the change it would bring back has a
    // damaged file or no longer fits the game, so no button that can only fail)
    if (!Number.isInteger(u.to) || !Number.isInteger(u.last)) return null;
    return { to: u.to, last: u.last, revive: Boolean(u.revive) };
  }
  const byN = new Map(versions.map((v) => [v.n, v]));
  // a list without `parent` (a server before 1.0): the version just below, as History always did
  const parentOf = (v) => (Number.isInteger(v.parent) ? v.parent : versions.filter((x) => x.n < v.n).sort((a, b) => b.n - a.n)[0]?.n ?? 0);
  let cur = byN.get(active);
  for (let i = 0; i < 64 && cur && GAME_MADE.has(cur.kind) && byN.has(parentOf(cur)); i++) cur = byN.get(parentOf(cur));
  if (!cur) return null;
  let to = Math.max(0, parentOf(cur));
  // an undo of a pause brings back the farmer's own change below the pause, never the pause (QA r3 H3-05)
  if (cur.kind === 'undo') for (let i = 0; i < 64 && byN.get(to)?.kind === 'suspend' && byN.has(parentOf(byN.get(to))); i++) to = parentOf(byN.get(to));
  return { to, last: cur.n, revive: cur.kind === 'undo' && to > 0 };
}

/** The versions, newest first. ctx: { lang, nameOf(pid), onUndo(to | null, n | null, { revive, title } | null), busy }. */
export function historyList(history, ctx) {
  const versions = Array.isArray(history?.versions) ? history.versions : [];
  if (!versions.length) return h('p.hx-none', t('harness.hist.empty'));
  const active = Number.isInteger(history.active) ? history.active : null;
  const byN = new Map(versions.map((v) => [v.n, v]));
  // the number History shows (QA r2 H2-07: a discarded candidate takes none); an older server's list shows its own n
  const noOf = (n) => (Number.isInteger(byN.get(n)?.no) ? byN.get(n).no : n);
  const wrap = h('div.hx-history');
  // the versions the active one rebuilt (a rebuild holds their files): going back to one changes nothing, so it has no
  // "Go back to this" (QA r2 H2-01; the server refuses it NO_CHANGE anyway)
  const sameAsActive = new Set();
  for (let c = byN.get(active), i = 0; i < 64 && c && c.kind === 'rebuild' && Number.isInteger(c.parent); i++, c = byN.get(c.parent)) sameAsActive.add(c.parent);
  const plan = undoPlan(history);
  if (plan) {
    // harvey#17: on an undo version the same button brings the undone change back: it says so, by its title. A rebuild or
    // a pause on top is looked through (H2-01): the farmer's last change decides, and the confirm names where it goes
    const undone = plan.revive ? byN.get(plan.to) ?? null : null;
    const back = undone ? pickText(undone.title, ctx.lang) : '';
    const toNo = plan.to > 0 ? noOf(plan.to) : 0;
    // what it takes out of the shop and brings back, when the server said (QA r4 H4-04: the confirm names it)
    const u = history.undo && typeof history.undo === 'object' ? history.undo : null;
    const eff = u && (Array.isArray(u.left) || Array.isArray(u.back)) ? { left: u.left ?? [], back: u.back ?? [] } : null;
    wrap.append(h('div.hx-actions', h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: back ? 'bringBack' : 'undoLast' }, disabled: ctx.busy || null,
      on: { click: () => ctx.onUndo(null, toNo, back ? { revive: true, title: undone.title, eff } : eff ? { eff } : null) } },
      glyph('back', 20), back ? t('harness.hist.bringBack', { title: back }) : t('harness.hist.undoLast'))));
  }
  wrap.append(h('ol.hx-versions', versions.map((v) => {
    const isActive = v.n === active || v.state === 'active';
    const gameMade = GAME_MADE.has(v.kind);
    // a version the game made names no farmer (QA r2 H2-02: a pause stored before 1.0 still carried the old farmer)
    const who = gameMade ? '' : ctx.nameOf(v.by) ?? '';
    const when = Number.isFinite(v.at) ? fmtDate(v.at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
    const chips = changeRows(v.changes, ctx.lang);
    const shown = chips.slice(0, 4);
    // an undo that only brought things back (History's "Go back to this" on a version with more in it) is no "Undo" (QA r4
    // H4-04): it says where it went
    const wentBack = v.kind === 'undo' && Number.isInteger(v.undoTo) && v.undoTo > 0 && byN.has(v.undoTo)
      && Array.isArray(v.changes) && v.changes.length > 0 && v.changes.every((c) => c && c.op !== 'retire');
    const li = h(`li.hx-version${isActive ? '.is-active' : ''}`, { dataset: { n: String(v.n) } },
      h('div.hx-version-head',
        h('b', t('harness.hist.version', { n: noOf(v.n) })),
        wentBack ? h('span.hx-kind.kind-back', t('harness.hist.kind.back', { n: noOf(v.undoTo) }))
          : KIND_KEYS[v.kind] ? h(`span.hx-kind.kind-${v.kind}`, t(KIND_KEYS[v.kind])) : null,
        isActive ? h('span.hx-op.op-add', t('harness.hist.active')) : null),
      pickText(v.title, ctx.lang) ? h('p.hx-version-title', pickText(v.title, ctx.lang)) : null,
      who || when ? h('p.hx-sub', who && when ? t('harness.hist.byWhen', { name: who, when }) : who || when) : null,
      // the first wish, then how many follow-ups changed it (harvey#17: not only the last follow-up's words); a version the
      // game rebuilt for a new game version says what it left out instead (QA r1 H-14: nobody asked for anything again),
      // a pause says why (QA r2 H2-02)
      ...(v.kind === 'rebuild'
        ? ((left) => (left.length ? [h('p.hx-sub.hx-left-out', t('harness.hist.leftOut', { what: list(left.map((k) => t(`harness.hist.leftOut.${k}`))) }))] : []))(
          (Array.isArray(v.leftOut) ? v.leftOut : []).filter((k) => LEFT_OUT.includes(k)))
        : v.kind === 'suspend'
          ? [h('p.hx-sub.hx-paused', t(v.reason === 'BAD_JSON' ? 'harness.hist.paused.BAD_JSON' : 'harness.hist.paused.other'))]
          : ((ps) => (ps.length ? [h('p.hx-asked', t('harness.hist.asked', { prompt: shortWish(ps[0]) }),
            ps.length > 1 ? h('span.hx-plus', ` ${tn('harness.hist.plus', ps.length - 1)}`) : null)] : []))(
            Array.isArray(v.prompts) && v.prompts.length ? v.prompts : v.prompt ? [v.prompt] : [])),
      // a chip words its row as the ready sheet does (QA r3 H3-04: "Sky: golden", "All crops grow 20 % faster", never the
      // raw "sky", "music" or "growTimeBp")
      shown.length ? h('ul.hx-chips', shown.map((c) => h(`li.hx-chip.op-${c.op}`, c.icon ? h('img', { src: c.icon, alt: '', width: 20, height: 20, loading: 'lazy' }) : null, rowTitle(c))),
        chips.length > shown.length ? h('li.hx-chip.more', tn('harness.hist.more', chips.length - shown.length)) : null) : null);
    // QA r4 H4-07: the server's word on each version (`go`: one compile per version and active version): a version with
    // the farm's own effect, a damaged one, or one that no longer fits offers no "Go back to this" that can only be
    // refused; it says why instead. A list without the word (an older server) keeps the rebuild walk above
    const go = v.go && typeof v.go === 'object' ? v.go : null;
    if (!isActive && v.kind !== 'suspend' && active !== null) {
      if (go ? go.ok === true : !sameAsActive.has(v.n)) {
        const eff = go ? { left: go.left ?? [], back: go.back ?? [] } : null;
        li.append(h('div.hx-actions', h('button.btn.btn--paper.btn--small', { type: 'button', dataset: { act: 'goBack' }, disabled: ctx.busy || null,
          on: { click: () => ctx.onUndo(v.n, noOf(v.n), { go: true, eff }) } }, t('harness.hist.goBack'))));
      } else if (go && GO_WHY[go.code]) {
        li.append(h('p.hx-sub.hx-cannot-go', t(GO_WHY[go.code])));
      }
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
