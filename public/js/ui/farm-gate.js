// Multi-farm hosted mode (docs/agent-briefs/multi-farm.md): the farm gate, shown instead of the game when a farm says
// no over the socket (main.js: deny PRIVATE / INVITE / FULL / REKEYED / REJOIN), and the per-farm home-screen manifest.
//
//   showFarmGate(kind, { farmId }) -> HTMLElement   kind 'private' | 'invite' | 'full' | 'gone' (deleted, found later) |
//                                    'deleted' (a farmer deleted it while this screen was open) | 'rekeyed' (this
//                                    farmer was given a new key) | 'rejoin' (a spent new-key link) | 'home' (a home-screen
//                                    app without a key): the painted title scene with a parchment card, a way to start
//                                    your own farm, the farms on this device and the way back in (ui/link-open.js: ask
//                                    your partner for a new key, paste your personal link, scan its QR code or use a
//                                    photo of it), open on a lost device's gates, folded away on the others. No game
//                                    data: the page never got any.
//   GATE_TEXT                        the words per kind (tests)
//   parseFarmLink(text, origin)      { id, key, join, rejoin } from a pasted farm link, else null (pure, net/farm.js)
//   openScanned(text, { farmId })    open a scanned / pasted farm link (false when it is none)
//   installFarmManifest(id, secret)  "Add to Home Screen" reopens THIS farm as THIS farmer. iOS keeps a home-screen
//                                    app's storage apart from Safari's: the page's manifest link becomes a client-built
//                                    copy of /manifest.webmanifest whose start_url is /f/<id>#k=<secret> (a fragment:
//                                    never sent to a server, never in a server-side manifest). Android shares one
//                                    storage between Chrome and its home-screen apps and makes an installed app only
//                                    from an http(s) manifest: there the link is the keyless /f/<id>/manifest.webmanifest.
import { h, ensureStylesheet } from './dom.js';
import { langToggle } from './lang-toggle.js';
import { createFarmScope, farmsOnDevice, personalLink, parseFarmLink, farmLinkPath, isAndroid, TTL_DAYS } from '../net/farm.js';
import { waysBack } from './link-open.js';
import { PRIVACY_PATH } from '../front/links.js';
import { t, getters, lang } from '../i18n/index.js';

export const GATE_TEXT = getters({
  private: {
    title: () => t('multi.gate.private.title'),
    lead: () => t('multi.gate.private.lead'),
    note: () => t('multi.gate.private.note', { days: TTL_DAYS }),
  },
  invite: {
    title: () => t('multi.gate.invite.title'),
    lead: () => t('multi.gate.invite.lead', { days: 7 }),
    note: () => t('multi.gate.invite.note'),
  },
  gone: {
    title: () => t('multi.gate.gone.title'),
    lead: () => t('multi.gate.gone.lead', { days: TTL_DAYS }),
    note: null,
  },
  // a farmer deleted it while this screen was open (deny DELETED), or on this very screen (Settings > Farm)
  deleted: {
    title: () => t('privacy.gate.deleted.title'),
    lead: () => t('privacy.gate.deleted.lead'),
    note: null,
  },
  full: {
    title: () => t('multi.gate.full.title'),
    lead: () => t('multi.gate.full.lead'),
    note: null,
  },
  rekeyed: { title: () => t('keep.gate.rekeyed.title'), lead: () => t('keep.gate.rekeyed.lead'), note: null },
  rejoin: { title: () => t('keep.gate.rejoin.title'), lead: () => t('keep.gate.rejoin.lead'), note: null },
  home: { title: () => t('keep.gate.home.title'), lead: () => t('keep.gate.home.lead'), note: () => t('keep.gate.home.where') },
});

/** The gates of a device that may have lost its way in: the way back is shown open, not folded away. */
const LOST = new Set(['private', 'rekeyed', 'rejoin', 'home']);

/** Open a farm link that was pasted or scanned: this farm's key is kept and the page reloads; anything else navigates. */
function openFarmLink(got, { farmId, loc = globalThis.location, st = globalThis.localStorage }) {
  if (got.key && got.id === farmId && !got.join && !got.rejoin) {
    // the same page with another fragment would not reload: keep the key for this farm, then reload
    try { st?.setItem(createFarmScope(got.id).key('hh.key'), JSON.stringify(got.key)); } catch { /* storage blocked */ }
    loc.reload();
    return;
  }
  loc.assign(farmLinkPath(got));
}

/** A scanned (or pasted) farm link: opened, or false when the text is no farm link. */
export function openScanned(text, { farmId = null, loc = globalThis.location, st = globalThis.localStorage } = {}) {
  const got = parseFarmLink(text, { origin: loc?.origin ?? '', farmId });
  if (!got) return false;
  openFarmLink(got, { farmId, loc, st });
  return true;
}

/** A pasted farm link (net/farm.js; kept here for the callers that import it from the gate). */
export { parseFarmLink };

const describedLink = (f) => (f.name ? f.name : t('multi.gate.noName'));

export function showFarmGate(kind, { farmId = null, doc = globalThis.document, loc = globalThis.location,
  st = globalThis.localStorage } = {}) {
  const text = GATE_TEXT[kind] ?? GATE_TEXT.private;
  ensureStylesheet('/css/farm.css');
  doc.getElementById('farm-gate')?.remove();
  const boot = doc.getElementById('boot');
  if (boot) boot.hidden = true;
  const picker = doc.getElementById('slot-picker');
  if (picker) picker.hidden = true;

  const back = waysBack({ farmId, origin: loc?.origin ?? '', ask: kind !== 'home', title: LOST.has(kind) && kind !== 'home',
    onLink: (got) => openFarmLink(got, { farmId, loc, st }), doc });

  const mine = farmsOnDevice(st).filter((f) => f.id !== farmId);
  const others = mine.length
    ? h('div.gate-farms',
      h('h3', t('multi.farmsHere')),
      h('ul', mine.slice(0, 4).map((f) => h('li', h('a.gate-farm', { href: `/f/${encodeURIComponent(f.id)}` }, describedLink(f))))))
    : null;

  const el = h('section.modal-layer.farm-gate#farm-gate', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'farm-gate-title',
    'aria-describedby': 'farm-gate-lead', dataset: { gate: kind in GATE_TEXT ? kind : 'private' } },
  h('div.slot-card.wood.gate-card',
    h('div.slot-title', h('img.slot-logo', { src: '/assets/art/logo-wide.png', alt: 'Harvest Hollow', width: '1400', height: '336' })), // i18n-ok: brand
    h('div.slot-paper.paper', langToggle(() => showFarmGate(kind, { farmId, doc, loc, st })),
      h('h2.gate-title#farm-gate-title', { tabindex: '-1' }, text.title),
      h('p.gate-lead#farm-gate-lead', text.lead),
      text.note ? h('p.gate-note', text.note) : null,
      LOST.has(kind) ? back : null,
      h('div.gate-actions', h('a.btn', { href: '/' }, kind === 'gone' || kind === 'deleted' ? t('multi.start') : t('multi.gate.startOwn'))),
      others,
      // a deleted farm has no way back in: no "I have my personal farm link" there
      LOST.has(kind) || kind === 'deleted' ? null : h('details.gate-key',
        h('summary', t('multi.gate.haveLink')),
        h('p.gate-help', t('multi.gate.pasteHelp')),
        back),
      h('p.gate-privacy', h('a', { href: PRIVACY_PATH, target: '_blank', rel: 'noopener' }, t('privacy.gate.link'))))));
  doc.body.append(el);
  // the painting behind, the same as the slot picker's
  setTimeout(() => el.classList.add('painted'), 0);
  setTimeout(() => el.querySelector('#farm-gate-title')?.focus({ preventScroll: true }), 30);
  return el;
}

/** Android's keyless home-screen manifest of a farm in a language (the server answers ?lang=bg in Bulgarian). Pure. */
export const farmManifestHref = (href, l) => `${String(href).replace(/\?.*$/, '')}${l === 'bg' ? '?lang=bg' : ''}`;

/** The home-screen manifest of this farm (see the header). Never throws; a failed fetch keeps the page's own. */
export async function installFarmManifest(id, secret, { doc = globalThis.document, fetcher = globalThis.fetch, origin = globalThis.location?.origin,
  nav = globalThis.navigator } = {}) {
  try {
    const link = doc?.querySelector('link[rel="manifest"]');
    if (!link || !origin || !createFarmScope(id).multi) return null;
    if (!link.dataset.base) link.dataset.base = link.getAttribute('href');
    if (isAndroid(nav)) {
      const href = farmManifestHref(`/f/${encodeURIComponent(id)}/manifest.webmanifest`, lang());
      link.setAttribute('href', href);
      return { id: `/f/${id}`, start_url: `/f/${id}`, href };
    }
    const res = await fetcher(link.dataset.base, { cache: 'force-cache' });
    if (!res.ok) return null;
    const base = await res.json();
    if (!base || typeof base !== 'object' || !base.name) return null;
    const start = secret ? personalLink(origin, id, secret) : `${origin}/f/${encodeURIComponent(id)}`;
    const icons = (base.icons || []).map((i) => ({ ...i, src: new URL(i.src, origin).href }));
    const m = { ...base, id: `/f/${id}`, start_url: start, scope: `${origin}/`, icons };
    const href = `data:application/manifest+json,${encodeURIComponent(JSON.stringify(m))}`;
    link.setAttribute('href', href);
    return m;
  } catch { return null; }
}
