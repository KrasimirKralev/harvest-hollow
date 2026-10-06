// Multi-farm hosted mode: "the way back in" block, framework-free (the farm gate and the landing page both show it):
// ask your partner for a new key, paste your personal link, scan its QR code (camera) or use a photo of it.
//
//   waysBack({ farmId, origin, ask, title, onLink, doc }) -> HTMLElement   onLink({ id, key, join, rejoin }) with what
//                                                                          was pasted or scanned (net/farm.js parse)
import { parseFarmLink } from '../net/farm.js';
import { t } from '../i18n/keep.js';
import { cameraAvailable, readPhoto, scanCamera } from './qr-scan.js';

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export function waysBack({ farmId = null, origin = globalThis.location?.origin ?? '', ask = true, title = true, onLink,
  doc = globalThis.document, nav = globalThis.navigator } = {}) {
  const box = el(doc, 'div', 'gate-back');
  if (title) box.append(el(doc, 'h3', 'gate-back-title', t('keep.gate.back.title')));
  if (ask) box.append(el(doc, 'p', 'gate-ask', t('keep.gate.back.ask')));
  const err = el(doc, 'p', 'modal-error');
  err.setAttribute('role', 'alert');
  const label = el(doc, 'label', 'gate-help', t('keep.gate.back.paste'));
  label.setAttribute('for', 'farm-gate-link');
  const input = el(doc, 'input', 'field gate-link');
  for (const [k, v] of Object.entries({ type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'https://…/f/…#k=…', id: 'farm-gate-link' })) input.setAttribute(k, v);
  const take = (text, bad) => {
    const got = parseFarmLink(text, { origin, farmId });
    if (!got) { err.textContent = t(bad); return false; }
    err.textContent = '';
    onLink?.(got);
    return true;
  };
  const open = el(doc, 'button', 'btn btn--sky btn--small', t('keep.gate.back.open'));
  open.type = 'button';
  open.addEventListener('click', () => { if (!take(input.value, 'keep.gate.back.bad')) input.focus?.(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault?.(); open.click(); } });
  const row = el(doc, 'div', 'gate-row');
  row.append(input, open);
  box.append(label, row);

  const scans = el(doc, 'div', 'gate-scan');
  if (cameraAvailable(nav)) {
    const cam = el(doc, 'button', 'btn btn--small', t('keep.gate.back.scan'));
    cam.type = 'button';
    cam.dataset.scan = 'camera';
    cam.addEventListener('click', () => {
      err.textContent = '';
      scanCamera({ onText: (text) => take(text, 'keep.gate.back.notlink'), onFail: (m) => { err.textContent = m; } });
    });
    scans.append(cam);
  }
  const file = el(doc, 'input', 'gate-file');
  file.type = 'file';
  file.setAttribute('accept', 'image/*');
  file.setAttribute('aria-hidden', 'true');
  file.setAttribute('tabindex', '-1');
  file.hidden = true;
  const photo = el(doc, 'button', `btn btn--small${cameraAvailable(nav) ? ' btn--paper' : ''}`, t('keep.gate.back.photo'));
  photo.type = 'button';
  photo.dataset.scan = 'photo';
  photo.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    err.textContent = '';
    const text = await readPhoto(f);
    if (!text) { err.textContent = t('keep.gate.back.noqr'); return; }
    take(text, 'keep.gate.back.notlink');
  });
  scans.append(photo, file);
  box.append(scans, err);
  return box;
}
