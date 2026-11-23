// "English · Български" (i18n lane A): the language toggle of the farmer picker, the farm gate and the landing page
// (the loading screen has the same markup in index.html, wired before any module loads; Settings has its own row).
// Plain DOM and the i18n engine only, so the landing page can use it without the game's modules.
//
//   langToggle(onSwitched?) -> <div class="lang-pick">   a tap switches at once (i18n/core.js setLang: remembered on
//                                                         this device); onSwitched(lang) re-draws what the caller built
import { lang, setLang, onLang, LANGS, LANG_NAMES } from '../i18n/core.js';

export function langToggle(onSwitched) {
  const doc = globalThis.document;
  const el = doc.createElement('div');
  el.className = 'lang-pick';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', `${LANG_NAMES.en} / ${LANG_NAMES.bg}`);
  const paint = () => { for (const b of el.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang())); };
  LANGS.forEach((l, i) => {
    if (i) {
      const dot = doc.createElement('span');
      dot.className = 'lang-dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = '·';
      el.append(dot);
    }
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = 'lang-opt';
    b.lang = l;
    b.dataset.lang = l;
    b.textContent = LANG_NAMES[l];
    b.addEventListener('click', async () => {
      const was = lang();
      await setLang(l);
      paint();
      if (lang() !== was) onSwitched?.(lang());
    });
    el.append(b);
  });
  paint();
  const off = onLang(() => { if (!el.isConnected) { off(); return; } paint(); });
  return el;
}
