// Multi-farm hosted mode (docs/agent-briefs/multi-farm.md): the farm gate, shown instead of the game when a farm says
// no over the socket (main.js: deny PRIVATE / INVITE / FULL), and the per-farm home-screen manifest.
//
//   showFarmGate(kind, { farmId }) -> HTMLElement   kind 'private' | 'invite' | 'full' | 'gone' (deleted): the painted title scene with a
//                                    parchment card ("This farm is private — ask its farmer for an invite link"), a
//                                    way to start your own farm, the farms on this device and "I have my personal farm
//                                    link" (paste it here). No game data: the page never got any.
//   GATE_TEXT                        the words per kind (tests)
//   parseFarmLink(text, origin)      { id, key, join } from a pasted farm link, else null (pure)
//   installFarmManifest(id, secret)  "Add to Home Screen" reopens THIS farm as THIS farmer: the page's manifest link
//                                    becomes a copy of /manifest.webmanifest whose start_url is /f/<id>#k=<secret>
//                                    (the fragment never reaches a server; iOS keeps a home-screen app's storage apart
//                                    from Safari's, so the key in the start URL is what lets it in)
import { h, ensureStylesheet } from './dom.js';
import { createFarmScope, farmIdOf, farmsOnDevice, readLaunch, personalLink, TTL_DAYS } from '../net/farm.js';

export const GATE_TEXT = Object.freeze({
  private: Object.freeze({
    title: 'This farm is private',
    lead: 'Ask its farmer for an invite link.',
    note: `Farms nobody visits for ${TTL_DAYS} days are deleted, so an old link may lead to a farm that is gone.`,
  }),
  invite: Object.freeze({
    title: 'This invite link no longer works',
    lead: 'An invite opens the gate once, for one friend, for 7 days. Ask the farmer for a new link.',
    note: 'A new invite also replaces the old one, so only the newest link works.',
  }),
  gone: Object.freeze({
    title: 'This farm is gone',
    lead: `Nobody visited it for ${TTL_DAYS} days, so it was deleted. A new farm takes one tap.`,
    note: null,
  }),
  full: Object.freeze({
    title: 'This farm already has two farmers',
    lead: 'A farm is for two. Start your own and invite a friend!',
    note: null,
  }),
});

/** A pasted farm link (or just its '#k=…' part, for this farm) -> { id, key, join } | null. Pure. */
export function parseFarmLink(text, { origin = '', farmId = null } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  let url;
  try {
    url = new URL(raw, origin || 'http://x.invalid');
  } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  const id = farmIdOf(url.pathname) ?? (raw.startsWith('#') || raw.startsWith('?') ? farmId : null);
  if (!id) return null;
  const { key, join } = readLaunch(url);
  return key || join ? { id, key, join } : null;
}

const describedLink = (f) => (f.name ? f.name : 'A farm without a name yet');

export function showFarmGate(kind, { farmId = null, doc = globalThis.document, loc = globalThis.location,
  st = globalThis.localStorage } = {}) {
  const text = GATE_TEXT[kind] ?? GATE_TEXT.private;
  ensureStylesheet('/css/farm.css');
  doc.getElementById('farm-gate')?.remove();
  const boot = doc.getElementById('boot');
  if (boot) boot.hidden = true;
  const picker = doc.getElementById('slot-picker');
  if (picker) picker.hidden = true;

  const err = h('p.modal-error', { role: 'alert' });
  const input = h('input.field.gate-link', { type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false',
    placeholder: 'https://…/f/…#k=…', 'aria-label': 'Your personal farm link', id: 'farm-gate-link' });
  const open = () => {
    const got = parseFarmLink(input.value, { origin: loc?.origin ?? '', farmId });
    if (!got) { err.textContent = 'That does not look like a farm link. It starts with the address of this site.'; input.focus(); return; }
    err.textContent = '';
    if (got.key && got.id === farmId && !got.join) {
      // the same page with another fragment would not reload: keep the key for this farm, then reload
      try { st?.setItem(createFarmScope(got.id).key('hh.key'), JSON.stringify(got.key)); } catch { /* storage blocked */ }
      loc.reload();
      return;
    }
    loc.assign(got.key ? personalLink('', got.id, got.key) : `/f/${encodeURIComponent(got.id)}?join=${encodeURIComponent(got.join)}`);
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); open(); } });

  const mine = farmsOnDevice(st).filter((f) => f.id !== farmId);
  const others = mine.length
    ? h('div.gate-farms',
      h('h3', 'Your farms on this device'),
      h('ul', mine.slice(0, 4).map((f) => h('li', h('a.gate-farm', { href: `/f/${encodeURIComponent(f.id)}` }, describedLink(f))))))
    : null;

  const el = h('section.modal-layer.farm-gate#farm-gate', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'farm-gate-title',
    'aria-describedby': 'farm-gate-lead', dataset: { gate: kind in GATE_TEXT ? kind : 'private' } },
  h('div.slot-card.wood.gate-card',
    h('div.slot-title', h('img.slot-logo', { src: '/assets/art/logo-wide.png', alt: 'Harvest Hollow', width: '1400', height: '336' })),
    h('div.slot-paper.paper',
      h('h2.gate-title#farm-gate-title', { tabindex: '-1' }, text.title),
      h('p.gate-lead#farm-gate-lead', text.lead),
      text.note ? h('p.gate-note', text.note) : null,
      h('div.gate-actions', h('a.btn', { href: '/' }, kind === 'gone' ? 'Start a new farm' : 'Start your own farm')),
      others,
      h('details.gate-key',
        h('summary', 'I have my personal farm link'),
        h('p.gate-help', 'It opens the farm as you on any device. Paste it here:'),
        h('div.gate-row', input, h('button.btn.btn--sky.btn--small', { type: 'button', on: { click: open } }, 'Open')),
        err))));
  doc.body.append(el);
  // the painting behind, the same as the slot picker's
  setTimeout(() => el.classList.add('painted'), 0);
  setTimeout(() => el.querySelector('#farm-gate-title')?.focus({ preventScroll: true }), 30);
  return el;
}

/** The home-screen manifest of this farm (see the header). Never throws; a failed fetch keeps the page's own. */
export async function installFarmManifest(id, secret, { doc = globalThis.document, fetcher = globalThis.fetch, origin = globalThis.location?.origin } = {}) {
  try {
    const link = doc?.querySelector('link[rel="manifest"]');
    if (!link || !origin || !createFarmScope(id).multi) return null;
    if (!link.dataset.base) link.dataset.base = link.getAttribute('href');
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
