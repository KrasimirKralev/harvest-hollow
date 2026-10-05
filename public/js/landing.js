// The multi-farm front door (public/landing.html, docs/agent-briefs/multi-farm.md): Start a new farm (one tap: POST
// /api/farms, the creator's secret kept for that farm on this device, then /f/<id> and the game's first-run flow),
// the farms this device has opened, the "we are full" state, and the home-screen app's start: launched from the
// home screen at / it goes straight on to the newest farm.
import { createFarmScope, farmsOnDevice, forgetFarm, rememberFarm, startFarm } from './net/farm.js';

const $ = (id) => document.getElementById(id);
const st = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();

/** Can this window keep a farm (a private window, blocked storage)? */
function storageWorks() {
  try {
    st.setItem('hh.probe', '1');
    st.removeItem('hh.probe');
    return true;
  } catch { return false; }
}

const AGO = [[86_400_000, 'day'], [3_600_000, 'hour'], [60_000, 'minute']];
/** "2 days ago" for a time in the past (pure). */
export function ago(ms, now = Date.now()) {
  const d = Math.max(0, now - (Number(ms) || 0));
  for (const [unit, name] of AGO) {
    const n = Math.floor(d / unit);
    if (n >= 1) return `${n} ${name}${n === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

function renderFarms() {
  const list = farmsOnDevice(st);
  $('ld-farms').hidden = list.length === 0;
  $('ld-list').replaceChildren(...list.map((f) => {
    const li = document.createElement('li');
    li.className = 'ld-farm';
    const a = document.createElement('a');
    a.className = 'ld-open';
    a.href = `/f/${encodeURIComponent(f.id)}`;
    const name = document.createElement('span');
    name.className = 'ld-name';
    name.textContent = f.name || 'A new farm';
    const when = document.createElement('span');
    when.className = 'ld-when';
    when.textContent = `Last opened ${ago(f.lastOpen)}`;
    a.append(name, when);
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'ld-forget';
    x.textContent = '✕';
    x.setAttribute('aria-label', `Forget ${f.name || 'this farm'} on this device`);
    x.title = 'Forget on this device';
    x.addEventListener('click', () => {
      // forgetting drops this device's key: without the personal link it cannot come back in
      const ok = globalThis.confirm?.(`Forget "${f.name || 'this farm'}" on this device? The farm itself stays; you get back in only with your personal farm link.`);
      if (!ok) return;
      forgetFarm(st, f.id);
      renderFarms();
      $('ld-start').focus();
    });
    li.append(a, x);
    return li;
  }));
}

async function start() {
  const btn = $('ld-start');
  const status = $('ld-status');
  if (btn.disabled) return;
  btn.disabled = true;
  btn.textContent = 'Planting your farm…';
  status.textContent = '';
  const r = await startFarm((u, o) => fetch(u, o));
  if (r.ok) {
    try { st?.setItem(createFarmScope(r.id).key('hh.key'), JSON.stringify(r.secret)); } catch { /* the page carries on without */ }
    rememberFarm(st, { id: r.id });
    status.textContent = 'Your farm is ready. Opening the gate…';
    // the secret stays out of the address: the game reads it from this device's storage
    location.assign(`/f/${encodeURIComponent(r.id)}`);
    return;
  }
  btn.disabled = false;
  btn.textContent = 'Start a new farm';
  if (r.code === 'FULL') {
    $('ld-full').hidden = false;
    btn.disabled = true;
    btn.setAttribute('aria-disabled', 'true');
    status.textContent = 'The valley is full right now. Please try again tomorrow.';
    $('ld-full-title').scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (r.code === 'RATE') {
    const mins = r.retryAfter ? Math.max(1, Math.ceil(r.retryAfter / 60)) : null;
    status.textContent = mins && mins < 120
      // the limit is per network address, so it may be a housemate's farms: say what happened, not who did it
      ? `Lots of new farms were just started from this network. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`
      : 'Lots of new farms were just started from this network. Try again a little later.';
    return;
  }
  status.textContent = 'The farm server did not answer. Try again in a moment.';
}

function boot() {
  // the home-screen app opens at /: carry on to the newest farm (a farm's own manifest names it; this is the fallback)
  const standalone = Boolean(globalThis.matchMedia?.('(display-mode: standalone)').matches || globalThis.navigator?.standalone);
  const newest = farmsOnDevice(st)[0];
  if (standalone && newest && !new URLSearchParams(location.search).has('home')) {
    location.replace(`/f/${encodeURIComponent(newest.id)}`);
    return;
  }
  $('ld-storage').hidden = Boolean(st) && storageWorks();
  $('ld-start').addEventListener('click', start);
  renderFarms();
}

if (typeof document !== 'undefined' && document.getElementById('landing')) boot();
