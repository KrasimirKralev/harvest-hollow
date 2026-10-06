// The multi-farm front door (public/landing.html, docs/agent-briefs/multi-farm.md), one screen (owner request
// 2026-10-05): Play = start a new farm (one tap: POST /api/farms, the creator's secret kept for that farm on this
// device, then /f/<id> and the game's first-run flow), Star us on GitHub (with the live count from GET /api/stars),
// Open GitHub; the farms this device has opened; the "we are full" and rate-limit states; the home-screen app's start
// (launched from the home screen at / it goes straight on to the newest farm). Behind the small links: "Already have a
// farm?" (paste your personal link or scan its QR code, ui/link-open.js; on the page itself, before the actions, in a
// home-screen app that knows no farm yet: its storage is apart from the browser's on iOS), "Suggest an idea" (the
// ideas form, front/ideas.js) and the screenshots (front/gallery.js), each in a sheet.
// The first view is the page, css/landing.css, one font, the logo and the orb's still. After the first paint: the
// orbiting farm video (never under reduced motion or Save-Data), the star count, and the sheets' code and styles.
// Words: the 'front' catalog area (i18n/front.js; the title and description are 'multi.ld.*'), English or Bulgarian, with
// the English · Български toggle in the top corner (remembered on this device, i18n/core.js); a Bulgarian page waits
// for its catalog before it shows (landing.html), and a switch re-says everything, the open sheets included.
import { createFarmScope, farmsOnDevice, forgetFarm, rememberFarm, startFarm, farmLinkPath, isStandalone } from './net/farm.js';
import { t, ready, loaded, onLang, applyStatic, retell } from './i18n/front.js';
import { langToggle } from './ui/lang-toggle.js';

const $ = (id) => document.getElementById(id);
const st = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();
const media = (q) => { try { return globalThis.matchMedia?.(q) ?? null; } catch { return null; } };

/** Can this window keep a farm (a private window, blocked storage)? */
function storageWorks() {
  try {
    st.setItem('hh.probe', '1');
    st.removeItem('hh.probe');
    return true;
  } catch { return false; }
}

const AGO = [[86_400_000, 'front.ago.day'], [3_600_000, 'front.ago.hour'], [60_000, 'front.ago.minute']];
/** "2 days ago" for a time in the past (pure for the language in effect). */
export function ago(ms, now = Date.now()) {
  const d = Math.max(0, now - (Number(ms) || 0));
  for (const [unit, key] of AGO) {
    const n = Math.floor(d / unit);
    if (n >= 1) return t(key, { n });
  }
  return t('front.ago.now');
}

function renderFarms() {
  const list = farmsOnDevice(st);
  $('ld-farms').hidden = list.length === 0;
  $('ld-list').replaceChildren(...list.map((f) => {
    const name = f.name || t('front.farms.unnamed');
    const li = document.createElement('li');
    li.className = 'ld-farm';
    const a = document.createElement('a');
    a.className = 'ld-open';
    a.href = `/f/${encodeURIComponent(f.id)}`;
    const txt = Object.assign(document.createElement('span'), { className: 'ld-open-txt' });
    txt.append(Object.assign(document.createElement('span'), { className: 'ld-name', textContent: name }),
      Object.assign(document.createElement('span'), { className: 'ld-when', textContent: t('front.farms.last', { when: ago(f.lastOpen) }) }));
    a.append(txt);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'ld-forget';
    x.textContent = '✕';
    x.setAttribute('aria-label', t('front.farms.forgetLabel', { name: f.name || t('front.farms.this') }));
    x.title = t('front.farms.forget');
    x.addEventListener('click', () => {
      // forgetting drops this device's key: without the personal link it cannot come back in
      if (!globalThis.confirm?.(t('front.farms.forgetAsk', { name: f.name || t('front.farms.this') }))) return;
      forgetFarm(st, f.id);
      renderFarms();
      $('ld-start').focus();
    });
    li.append(a, x);
    return li;
  }));
}

/** Play: back to its resting words (also after the back/forward cache brings the page back mid-start). */
function playReady() {
  const btn = $('ld-start');
  if (btn.getAttribute('aria-disabled') === 'true') return;          // the valley is full: it stays off
  btn.disabled = false;
  btn.removeAttribute('aria-busy');
  $('ld-start-sub').textContent = t('front.act.playSub');
}

async function start() {
  const btn = $('ld-start');
  const status = $('ld-status');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  $('ld-start-sub').textContent = t('front.start.busy');
  status.textContent = '';
  // the new farm's key lives in this browser: ask it to keep the storage (a browser may ask the player; no answer is
  // needed, the in-game "Keep your farm safe" card covers the rest)
  try { globalThis.navigator?.storage?.persist?.()?.catch?.(() => {}); } catch { /* no storage manager */ }
  const r = await startFarm((u, o) => fetch(u, o));
  if (r.ok) {
    try { st?.setItem(createFarmScope(r.id).key('hh.key'), JSON.stringify(r.secret)); } catch { /* the page carries on without */ }
    rememberFarm(st, { id: r.id });
    status.textContent = t('front.start.ready');
    // the secret stays out of the address: the game reads it from this device's storage
    location.assign(`/f/${encodeURIComponent(r.id)}`);
    return;
  }
  playReady();
  if (r.code === 'FULL') {
    $('ld-full').hidden = false;
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    status.textContent = t('front.start.full');
    $('ld-full').scrollIntoView?.({ block: 'center', behavior: media('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth' });
    return;
  }
  if (r.code === 'RATE') {
    const mins = r.retryAfter ? Math.max(1, Math.ceil(r.retryAfter / 60)) : null;
    // the limit is per network address, so it may be a housemate's farms: say what happened, not who did it
    status.textContent = mins && mins < 120 ? t('front.start.rate', { n: mins }) : t('front.start.rateLater');
    return;
  }
  status.textContent = t('front.start.net');
}

/** `fn` once the page has painted and the browser is idle (the first view never waits for it). */
function afterPaint(fn) {
  const run = () => {
    const go = () => Promise.resolve().then(fn).catch((err) => console.error('landing: a late part failed', err));
    if (typeof globalThis.requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 1500 });
    else setTimeout(go, 200);
  };
  if (document.readyState === 'complete') run();
  else addEventListener('load', run, { once: true });
}

/** A stylesheet, resolved once it has loaded (or failed: the content shows anyway). Before css/landing.css, so the
 *  page's own rules keep winning over the game's base rules at equal specificity. */
const sheets = new Map();
function stylesheet(href) {
  if (!sheets.has(href)) {
    sheets.set(href, new Promise((resolve) => {
      const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href });
      link.addEventListener('load', resolve, { once: true });
      link.addEventListener('error', resolve, { once: true });
      const own = document.querySelector('link[rel="stylesheet"][href*="/css/landing.css"]');
      if (own) own.before(link); else document.head.append(link);
    }));
  }
  return sheets.get(href);
}
/** The game's tokens, buttons and the way-back block's styles: what the sheets' insides are drawn with. */
const sheetStyles = () => Promise.all([stylesheet('/css/style.css'), stylesheet('/css/farm.css')]);

// ---- the sheets ----------------------------------------------------------------------------------------------------
function wireSheet(dialog) {
  let opener = null;
  dialog.addEventListener('click', (e) => {
    // the dim backdrop (the dialog box itself, outside its content) or a close button
    if (e.target !== dialog && !e.target.closest?.('[data-close]')) return;
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
  });
  dialog.addEventListener('close', () => { opener?.focus?.({ preventScroll: true }); opener = null; });
  return (from) => {
    opener = from;
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
  };
}

let backReady = null;
let backBox = null;            // the way back's block, built again in a new language (what was pasted stays)
let waysBackOf = null;
function paintBack() {
  const typed = backBox?.querySelector('input.gate-link')?.value ?? '';
  const box = waysBackOf({ ask: false, title: false, onLink: (got) => location.assign(farmLinkPath(got)) });
  const input = box.querySelector('input.gate-link');
  if (input && typed) input.value = typed;
  (backBox ?? $('ld-back-slot')).replaceWith(box);
  backBox = box;
}
/** "Already have a farm?": the way back in (paste, scan), built once (its words, area 'keep', come with it). */
function buildBack() {
  backReady ??= Promise.all([import('./ui/link-open.js'), sheetStyles()]).then(async ([{ waysBack }]) => {
    await loaded();
    waysBackOf = waysBack;
    paintBack();
  }).catch((err) => { backReady = null; throw err; });
  return backReady;
}

let ideasReady = null;
let ideas = null;              // the ideas form (built again in a new language from its draft)
let ideaFormOf = null;
function paintIdeas() {
  ideas = ideaFormOf({ prefix: 'ld-idea', draft: ideas?.draft() ?? null });
  $('ld-idea-form').replaceChildren(ideas.el);
}
/** "Suggest an idea": the ideas form, built once. */
function buildIdeas() {
  ideasReady ??= Promise.all([import('./front/ideas.js'), sheetStyles(), stylesheet('/css/ideas.css')]).then(([{ ideaForm }]) => {
    ideaFormOf = ideaForm;
    paintIdeas();
  }).catch((err) => { ideasReady = null; throw err; });
  return ideasReady;
}

const SHOTS = [['1-farm', 'front.shot.farm'], ['2-together', 'front.shot.together'], ['3-animals', 'front.shot.animals'],
  ['4-bakery', 'front.shot.bakery'], ['5-phone', 'front.shot.phone']];
let gallery = null;
async function openShots(from) {
  if (!gallery) {
    const { createGallery } = await import('./front/gallery.js');
    gallery = createGallery(SHOTS.map(([f, key]) => ({ full: `/assets/landing/shot-${f}.webp`, mid: `/assets/landing/shot-${f}_960.webp`,
      get caption() { return t(key); }, w: 1600, h: 1000 })));
  }
  if (gallery) gallery.open(0, from);
  else location.assign(`/assets/landing/shot-${SHOTS[0][0]}.webp`);   // no <dialog>: the picture itself
}

// ---- after the first paint: the living farm and the star count -----------------------------------------------------
const VIDEO = [['/assets/landing/farm-orbit.webm', 'video/webm; codecs="vp9"'], ['/assets/landing/farm-orbit.mp4', 'video/mp4; codecs="avc1.4D401F"']];

/** The orbiting farm over the orb's still: muted, looping, only while the orb is on screen; never under reduced motion
 *  or Save-Data (the still stays). */
function startVideo() {
  const still = media('(prefers-reduced-motion: reduce)');
  if (still?.matches || globalThis.navigator?.connection?.saveData === true) return;
  const v = document.createElement('video');
  v.muted = true;
  v.defaultMuted = true;
  v.loop = true;
  v.playsInline = true;
  v.preload = 'auto';
  for (const a of ['muted', 'playsinline', 'loop', 'disablepictureinpicture']) v.setAttribute(a, '');
  v.setAttribute('aria-hidden', 'true');
  v.tabIndex = -1;
  for (const [src, type] of VIDEO) {
    if (!v.canPlayType?.(type)) continue;
    v.append(Object.assign(document.createElement('source'), { src, type }));
  }
  if (!v.children.length) return;
  v.addEventListener('playing', () => v.classList.add('is-on'), { once: true });
  v.addEventListener('error', () => v.remove(), { once: true });
  $('ld-orb-view').append(v);
  const play = () => { if (!still?.matches) v.play?.()?.catch?.(() => {}); };
  let seen = true;
  if (typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => {
      seen = entries.some((e) => e.isIntersecting);
      if (seen) play(); else v.pause();
    }).observe($('ld-orb'));
  }
  still?.addEventListener?.('change', (e) => { if (e.matches) { v.pause(); v.classList.remove('is-on'); } else if (seen) { play(); v.classList.add('is-on'); } });
  play();
}

let stars = null;
async function showStars() {
  const { starCount, shortCount } = await import('./front/stars.js');
  const n = await starCount();
  if (n === null || n < 1) return;               // no number rather than a sad zero or an error
  stars = n;
  const pill = $('ld-star-n');
  pill.textContent = shortCount(n);
  pill.setAttribute('aria-hidden', 'true');
  // the link's name reads "Star us on GitHub, 1,234 stars" (the pill's "1.2k" is for the eyes)
  pill.after(Object.assign(document.createElement('span'), { className: 'sr-only', id: 'ld-star-sr' }));
  sayStars();
  pill.hidden = false;
}
function sayStars() {
  const sr = $('ld-star-sr');
  if (sr && stars !== null) sr.textContent = `, ${t('front.star.count', { n: stars })}`;
}

/** Every word on the page in the language in effect (the static markup, the title, what the code wrote). */
function relabel() {
  // the status line (a refusal, "Planting your farm…") is said again in the new language
  const status = $('ld-status');
  const again = status.textContent ? retell(status.textContent) : null;
  applyStatic(document);
  document.title = t('multi.ld.title');
  if (again) status.textContent = again();
  if ($('ld-start').getAttribute('aria-busy') === 'true') $('ld-start-sub').textContent = t('front.start.busy');
  sayStars();
  renderFarms();
}

async function boot() {
  // the home-screen app opens at /: carry on to the newest farm (a farm's own manifest names it; this is the fallback)
  const standalone = isStandalone();
  const newest = farmsOnDevice(st)[0];
  if (standalone && newest && !new URLSearchParams(location.search).has('home')) {
    location.replace(`/f/${encodeURIComponent(newest.id)}`);
    return;
  }
  // the language first (Bulgarian loads only when chosen), then the words, then the page shows
  await ready();
  relabel();
  document.documentElement.classList.remove('i18n-wait');
  $('ld-lang').append(langToggle());
  onLang(() => {
    relabel();
    // the sheets built so far say it again (what was typed stays); the screenshots re-say themselves (front/gallery.js)
    if (waysBackOf) loaded().then(paintBack);
    if (ideaFormOf) paintIdeas();
  });
  $('ld-storage').hidden = Boolean(st) && storageWorks();
  $('ld-start').addEventListener('click', start);

  const openBack = wireSheet($('ld-sheet-back'));
  const openIdeas = wireSheet($('ld-sheet-ideas'));
  // a home-screen app that knows no farm: opening yours here comes first, on the page, before the actions
  const inline = standalone && !newest;
  if (inline) {
    const back = $('ld-back');
    back.classList.add('ld-back--inline');
    $('ld-dock').before(back);
    buildBack().catch((err) => console.error('landing: the way back failed to load', err));
  }
  $('ld-back-open').addEventListener('click', (e) => {
    if (inline) { $('ld-back').scrollIntoView?.({ block: 'center' }); $('ld-back').querySelector('input')?.focus(); return; }
    openBack(e.currentTarget);
    buildBack().then(() => $('ld-back').querySelector('input')?.focus()).catch((err) => console.error('landing: the way back failed to load', err));
  });
  $('ld-ideas-open').addEventListener('click', (e) => {
    openIdeas(e.currentTarget);
    buildIdeas().catch((err) => console.error('landing: the ideas form failed to load', err));
  });
  $('ld-shots-open').addEventListener('click', (e) => { openShots(e.currentTarget).catch((err) => console.error('landing: the screenshots failed to load', err)); });

  // the back/forward cache brings the page back as it was left: Play mid-start, an old list
  addEventListener('pageshow', (e) => { if (e.persisted) { playReady(); $('ld-status').textContent = ''; renderFarms(); } });

  afterPaint(() => {
    startVideo();
    showStars().catch(() => {});
    // the sheets open at once when asked: their styles and code are fetched while the visitor looks around
    sheetStyles();
  });
}

if (typeof document !== 'undefined' && document.getElementById('landing')) boot();
