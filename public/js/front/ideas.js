// The ideas box on the client (server: server/ideas.js): the project links, the same checks the server makes, the
// POST, and the form itself, built once here for the landing page (js/landing.js) and the game's "Suggest an idea"
// card (ui/ideas.js). Styles: css/ideas.css. Words: the 'front' catalog area (i18n/front.js). Plain DOM only: the landing
// page loads no game code.
//
//   REPO_URL, IDEAS_URL, SELF_HOST_URL      re-exported from front/links.js (the form's small print links PRIVACY_PATH)
//   CATEGORIES, IDEA_LIMITS                 as the server has them
//   checkIdea(fields) -> { ok } | { ok: false, field, code, n? }      pure
//   sendIdea(fetch, fields) -> { ok, id } | { ok: false, code: 'RATE'|'FULL'|'BAD'|'NET', retryAfter? }   never throws
//   ideaForm({ prefix, farm, fetcher, lang, onDone, draft }) -> { el, focus(), draft() }   draft(): what is typed, to
//                                           build the form again in another language without losing a word
import { t, lang as pageLang } from '../i18n/front.js';
import { IDEAS_URL, PRIVACY_PATH } from './links.js';

export { REPO_URL, IDEAS_URL, SELF_HOST_URL } from './links.js';
export const CATEGORIES = Object.freeze([['content', '🌱'], ['feature', '✨'], ['bug', '🐛'], ['other', '💬']]);
export const IDEA_LIMITS = Object.freeze({ textMin: 10, textMax: 1000, nameMax: 40, contactMax: 120 });

const chars = (s) => [...String(s ?? '')].length;
const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The server's rules (server/ideas.js checkIdea), so the form can say what is wrong before it sends. Pure. */
export function checkIdea({ category, text, name = '', contact = '' } = {}) {
  if (!CATEGORIES.some(([id]) => id === category)) return { ok: false, field: 'category', code: 'category' };
  const words = String(text ?? '').trim();
  if (chars(words.replace(/\s+/g, ' ')) < IDEA_LIMITS.textMin) return { ok: false, field: 'text', code: 'short', n: IDEA_LIMITS.textMin - chars(words.replace(/\s+/g, ' ')) };
  if (chars(words) > IDEA_LIMITS.textMax) return { ok: false, field: 'text', code: 'long' };
  if (chars(squash(name)) > IDEA_LIMITS.nameMax) return { ok: false, field: 'name', code: 'name' };
  if (chars(squash(contact)) > IDEA_LIMITS.contactMax) return { ok: false, field: 'contact', code: 'contact' };
  return { ok: true };
}

/** POST /api/ideas. Never throws. */
export async function sendIdea(fetcher, { category, text, name = '', contact = '', farm = null, lang = null, website = '' }) {
  const body = { category, text: String(text).trim() };
  if (squash(name)) body.name = squash(name);
  if (squash(contact)) body.contact = squash(contact);
  if (farm) body.farm = farm;
  if (lang) body.lang = lang;
  if (website) body.website = website;
  let res;
  try {
    res = await fetcher('/api/ideas', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' });
  } catch { return { ok: false, code: 'NET' }; }
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  if (res.ok && json && typeof json.id === 'string') return { ok: true, id: json.id };
  if (res.status === 429) return { ok: false, code: 'RATE', retryAfter: Number(json?.retryAfter) || null };
  if (res.status === 503) return { ok: false, code: 'FULL' };
  if (res.status === 400) return { ok: false, code: 'BAD', field: json?.field ?? null };
  return { ok: false, code: 'NET' };
}

/** A tiny element builder: el('p.cls#id', { attrs, on: { click } }, ...children). Strings become text nodes. */
function el(spec, props = {}, ...kids) {
  const [tag, ...rest] = spec.split(/(?=[.#])/);
  const n = document.createElement(tag);
  for (const r of rest) { if (r[0] === '.') n.classList.add(r.slice(1)); else n.id = r.slice(1); }
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
  return n;
}

/**
 * The ideas form: category chips, the idea (with a live count), an optional name and contact, a honeypot, a privacy
 * line, Send, a status line, the GitHub link; on success a thank-you panel with "Send another idea".
 * `prefix` keeps ids unique on the page; `farm` (in game) rides along; `onDone(id)` after a stored idea; `lang` the
 * idea's language (default: the page's at the moment it is sent); `draft` a previous form's draft() to start from.
 */
export function ideaForm({ prefix = 'idea', farm = null, fetcher = (u, o) => globalThis.fetch(u, o), lang = null, onDone = null,
  draft = null } = {}) {
  const id = (s) => `${prefix}-${s}`;
  const cats = CATEGORIES.map(([cat, emo]) => el('label.idea-cat', {},
    el('input', { type: 'radio', name: id('cat'), value: cat, required: true }),
    el('span.idea-cat-face', {}, el('span.idea-cat-emo', { 'aria-hidden': 'true', text: emo }), el('span.idea-cat-lbl', { text: t(`front.ideas.cat.${cat}`) }))));
  const catErr = el('p.idea-err', { id: id('cat-err'), role: 'alert', hidden: true });
  const fieldset = el('fieldset.idea-cats', { 'aria-describedby': id('cat-err') },
    el('legend.idea-label', { text: t('front.ideas.cat') }), el('div.idea-cat-grid', {}, cats), catErr);

  const count = el('span.idea-count', { id: id('count'), 'aria-hidden': 'true' });
  const textErr = el('p.idea-err', { id: id('text-err'), role: 'alert', hidden: true });
  const text = el('textarea.idea-input.idea-text', { id: id('text'), name: 'text', rows: 5, maxlength: IDEA_LIMITS.textMax, required: true,
    placeholder: t('front.ideas.textHint'), 'aria-describedby': `${id('text-err')}`, spellcheck: 'true' });
  const paintCount = () => {
    const n = chars(text.value.trim());
    count.textContent = t('front.ideas.count', { n, max: IDEA_LIMITS.textMax });
    count.classList.toggle('near', n > IDEA_LIMITS.textMax * 0.9);
  };
  const optional = () => el('span.idea-opt', { text: ` ${t('front.ideas.optional')}` });
  const name = el('input.idea-input', { id: id('name'), name: 'name', type: 'text', maxlength: IDEA_LIMITS.nameMax, autocomplete: 'nickname' });
  const contact = el('input.idea-input', { id: id('contact'), name: 'contact', type: 'text', maxlength: IDEA_LIMITS.contactMax, autocomplete: 'email',
    inputmode: 'email', 'aria-describedby': id('contact-hint') });
  const otherErr = el('p.idea-err', { id: id('other-err'), role: 'alert', hidden: true });
  // a field people never see or reach (no tab stop, hidden from screen readers); a bot that fills every input is dropped
  const trap = el('input', { id: id('website'), name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' });
  const send = el('button.btn.idea-send', { type: 'submit', text: t('front.ideas.send') });
  const status = el('p.idea-status', { role: 'status', 'aria-live': 'polite' });
  const form = el('form.idea-form', { novalidate: true, 'aria-label': t('front.ideas.title') },
    fieldset,
    el('div.idea-field', {}, el('label.idea-label', { for: id('text'), text: t('front.ideas.text') }), text,
      el('div.idea-meta', {}, textErr, count)),
    el('div.idea-two', {},
      el('div.idea-field', {}, el('label.idea-label', { for: id('name') }, t('front.ideas.name'), optional()), name),
      el('div.idea-field', {}, el('label.idea-label', { for: id('contact') }, t('front.ideas.contact'), optional()), contact,
        // the small print: what the contact is for, and the privacy note (a new tab: the words typed here stay)
        el('p.idea-hint', { id: id('contact-hint') }, t('front.ideas.contactHint'), el('span', { 'aria-hidden': 'true', text: ' · ' }),
          el('a.idea-privacy-link', { href: PRIVACY_PATH, target: '_blank', rel: 'noopener', text: t('front.ideas.privacyLink') })))),
    otherErr,
    el('div.idea-trap', { 'aria-hidden': 'true' }, el('label', { for: id('website'), text: t('front.ideas.trap') }), trap),
    el('p.idea-privacy', { text: t('front.ideas.privacy') }),
    el('div.idea-acts', {}, send),
    status,
    el('p.idea-alt', {}, el('a', { href: IDEAS_URL, target: '_blank', rel: 'noopener', text: t('front.ideas.github') })));

  const doneMsg = el('p.idea-done-text', { text: t('front.ideas.thanksText') });
  const again = el('button.btn.btn--paper.btn--small', { type: 'button', text: t('front.ideas.another') });
  const done = el('div.idea-done', { hidden: true, tabindex: '-1', role: 'status' },
    el('p.idea-done-title', { text: t('front.ideas.thanks') }), doneMsg, again);
  const root = el('div.idea-box', {}, form, done);

  const showErr = (node, msg, field) => {
    node.textContent = msg || '';
    node.hidden = !msg;
    if (field) field.setAttribute('aria-invalid', msg ? 'true' : 'false');
  };
  const clearErrs = () => { showErr(catErr, '', fieldset); showErr(textErr, '', text); showErr(otherErr, '', null); name.removeAttribute('aria-invalid'); contact.removeAttribute('aria-invalid'); };
  const fields = () => ({ category: form.querySelector(`input[name="${id('cat')}"]:checked`)?.value ?? null, text: text.value, name: name.value, contact: contact.value });
  const sayCheck = (c) => {
    if (c.field === 'category') { showErr(catErr, t('front.ideas.err.category'), fieldset); cats[0].querySelector('input').focus(); }
    else if (c.field === 'text') { showErr(textErr, t(`front.ideas.err.${c.code}`, { min: IDEA_LIMITS.textMin, max: IDEA_LIMITS.textMax, n: c.n ?? 0 }), text); text.focus(); }
    else if (c.field === 'name') { showErr(otherErr, t('front.ideas.err.name', { max: IDEA_LIMITS.nameMax }), name); name.focus(); }
    else if (c.field === 'contact') { showErr(otherErr, t('front.ideas.err.contact', { max: IDEA_LIMITS.contactMax }), contact); contact.focus(); }
  };
  let busy = false;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    clearErrs();
    status.textContent = '';
    status.classList.remove('bad');
    const f = fields();
    const c = checkIdea(f);
    if (!c.ok) { sayCheck(c); return; }
    busy = true;
    send.disabled = true;
    send.textContent = t('front.ideas.sending');
    form.setAttribute('aria-busy', 'true');
    const r = await sendIdea(fetcher, { ...f, farm, lang: lang ?? pageLang(), website: trap.value });
    busy = false;
    send.disabled = false;
    send.textContent = t('front.ideas.send');
    form.removeAttribute('aria-busy');
    if (r.ok) {
      form.hidden = true;
      done.hidden = false;
      done.focus({ preventScroll: true });
      onDone?.(r.id);
      return;
    }
    // the words stay in the form: nothing typed is lost on a refusal
    if (r.code === 'BAD' && r.field) { sayCheck({ field: r.field, code: r.field === 'text' ? 'short' : r.field, n: 0 }); return; }
    status.textContent = t(`front.ideas.err.${r.code}`);
    status.classList.add('bad');
  });
  for (const r of cats) r.querySelector('input').addEventListener('change', () => showErr(catErr, '', fieldset));
  text.addEventListener('input', () => { paintCount(); if (!textErr.hidden && checkIdea({ ...fields(), category: 'other' }).ok) showErr(textErr, '', text); });
  again.addEventListener('click', () => {
    form.reset();
    paintCount();
    clearErrs();
    status.textContent = '';
    status.classList.remove('bad');
    done.hidden = true;
    form.hidden = false;
    cats[0].querySelector('input').focus();
  });
  // a form built again (a language switch) starts where the last one was: the words typed, the category, the thanks
  if (draft) {
    const cat = cats.find((c) => c.querySelector('input').value === draft.category);
    if (cat) cat.querySelector('input').checked = true;
    text.value = draft.text ?? '';
    name.value = draft.name ?? '';
    contact.value = draft.contact ?? '';
    if (draft.done) { form.hidden = true; done.hidden = false; }
  }
  paintCount();
  return { el: root, focus: () => cats[0].querySelector('input').focus({ preventScroll: true }), draft: () => ({ ...fields(), done: !done.hidden }) };
}
