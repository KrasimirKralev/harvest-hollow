// The helper's screens, loaded only where they are offered (Harness Hollow, lead 2026-10-13). The game boots without
// a byte of the helper's ui: after each welcome this asks the farm's server (GET <base>/state) and, only when it
// answers `enabled: true`, loads the stylesheet, the words (i18n area 'harness') and ui/harness/index.js, then hands the
// helper to ui/index.js. A server with the helper off (the hosted site until its owner turns it on) costs one small
// request per visit and nothing else.
//
//   bootHarness(S, onReady(helper)) -> stop()
import { farm, session as farmSession } from '../../net/farm.js';
import { onHarness, harnessAuth } from '../../harness/bus.js';
import { harnessBase } from '../../harness/api.js';
import { farmerKey } from './link.js';

/** The stylesheet with the page's own version stamp (server/static.js versions every stylesheet link). */
function loadCss(doc) {
  const href = '/css/harness.css';
  if (doc.querySelector(`link[href^="${href}"]`)) return Promise.resolve();
  const stamp = /\?v=[\w.-]+/.exec(doc.querySelector('link[rel="stylesheet"][href*="?v="]')?.getAttribute('href') ?? '')?.[0] ?? '';
  return new Promise((resolve) => {
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${href}${stamp}`;
    // a stylesheet that fails still lets the helper work (unstyled is better than missing)
    link.onload = () => resolve();
    link.onerror = () => resolve();
    doc.head.append(link);
  });
}

export function bootHarness(S, onReady, { doc = globalThis.document, fetcher = (...a) => globalThis.fetch(...a) } = {}) {
  let state = 'idle';             // idle | asking | loading | ready | stopped
  async function probe() {
    if (state !== 'idle') return;
    const key = farmerKey({ bus: { harnessAuth }, scope: farm, session: farmSession, pid: S.store?.pid });
    if (!key) return;
    state = 'asking';
    let on = false;
    try {
      const r = await fetcher(`${harnessBase(farm)}/state`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
      on = r.ok && (await r.json())?.enabled === true;
    } catch { on = false; }
    if (state === 'stopped') return;
    if (!on) { state = 'idle'; return; }            // asked again after the next welcome (a restart may turn it on)
    state = 'loading';
    try {
      const [m, i18n] = await Promise.all([import('./index.js'), import('../../i18n/harness.js'), loadCss(doc)]);
      await i18n.loaded();
      if (state === 'stopped') return;
      state = 'ready';
      onReady(m.createHarnessUi(S));
    } catch (err) {
      console.error('the helper did not start', err);
      state = 'idle';
    }
  }
  const offBus = onHarness((m) => { if (m.e === 'auth' && m.pid) probe(); });
  const offWelcome = S.store?.on?.('welcome', () => probe());
  if (harnessAuth()) probe();
  return () => { state = 'stopped'; offBus(); offWelcome?.(); };
}
