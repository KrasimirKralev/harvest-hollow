// Swan's comments (from MNKISWAN Cozy World, where Swan walks beside Mnki and says a gentle line at the milestones):
// a short line in Swan's voice, with her face, when something worth noticing happens on the farm. Firsts (the first
// harvest, the first fish, the first Beauty star) are said once per browser; the rest at most once a day each, and
// never more than one line a minute, so she stays a warm aside and never a chatter. Nothing here changes state.
// Owned by the client lane.
//
//   createSwanSays({ store, ui, now?, storage? }) -> { dispose() }
//   swanKey(ev, { mine, chain }) -> { key, once: 'ever' | 'day', lines: [i18n keys] } | null     pure, tested
import { questOf } from '../../../shared/content/index.js';
import { assetUrl } from '../net/asset-base.js';
import { t as tr } from '../i18n/index.js';

/** The fewest milliseconds between two of Swan's lines. */
export const SWAN_GAP_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * What Swan would say about an event, or null: `key` names the moment (for once-only bookkeeping), `once` says whether it
 * is said once ever ('ever') or once a day ('day'), `lines` are the i18n keys to choose from. `mine` is true when this
 * farmer did it; `chain` is the quest's chain for a questDone. Pure.
 */
export function swanKey(ev, { mine = false, chain = null } = {}) {
  if (!ev || typeof ev.e !== 'string') return null;
  switch (ev.e) {
    case 'harvested': return mine ? { key: 'harvest', once: 'ever', lines: ['game.swan.harvest'] } : null;
    case 'fishCaught':
      if (!mine) return null;
      return ev.record ? { key: 'fishRecord', once: 'day', lines: ['game.swan.fishRecord'] }
        : { key: 'fish', once: 'ever', lines: ['game.swan.fish'] };
    case 'beautyStar': return { key: `beauty${ev.stars ?? ''}`, once: 'ever', lines: ['game.swan.beauty'] };
    case 'expanded': return { key: `land:${ev.expansion ?? ''}`, once: 'ever', lines: ['game.swan.land'] };
    case 'petted': return mine ? { key: 'petted', once: 'day', lines: ['game.swan.petted'] } : null;
    case 'levelUp':
      if (ev.scope !== 'farm') return null;
      return { key: `level${ev.level ?? ''}`, once: 'ever', lines: ['game.swan.level1', 'game.swan.level2', 'game.swan.level3'] };
    case 'questDone':
      if (chain === 'V') return { key: `quest:${ev.id}`, once: 'ever', lines: ['game.swan.village'] };
      return mine ? { key: 'quest', once: 'day', lines: ['game.swan.quest'] } : null;
    default: return null;
  }
}

/** A storage that never throws (private mode, a full quota, or none at all). */
function safeStore(storage) {
  const mem = new Map();
  return {
    get(k) { try { return storage ? storage.getItem(k) : mem.get(k) ?? null; } catch { return mem.get(k) ?? null; } },
    set(k, v) { mem.set(k, v); try { storage?.setItem(k, v); } catch { /* memory only */ } },
  };
}

export function createSwanSays({ store, ui, now = () => Date.now(), storage = globalThis.localStorage } = {}) {
  const keep = safeStore(storage);
  const me = () => store?.pid;
  let last = -Infinity;
  const offs = [];

  function say(ev, by) {
    const chain = ev.e === 'questDone' ? questOf(ev.id)?.chain ?? null : null;
    const what = swanKey(ev, { mine: by != null && by === me(), chain });
    if (!what) return;
    const t = now();
    if (t - last < SWAN_GAP_MS && what.once !== 'ever') return;
    const mark = `swan:${what.key}${what.once === 'day' ? `:${Math.floor(t / DAY_MS)}` : ''}`;
    if (keep.get(mark)) return;
    keep.set(mark, '1');
    last = t;
    const key = what.lines[Math.floor(t / 1000) % what.lines.length];
    const el = ui?.toast?.(() => tr('game.swan.says', { line: tr(key) }), { kind: 'love', ms: 6500 });
    // her face in place of the round badge (MNKISWAN's own sticker art)
    const badge = el && typeof el.querySelector === 'function' ? el.querySelector('.ti') : null;
    if (badge && typeof document !== 'undefined') {
      const img = document.createElement('img');
      img.src = assetUrl('/assets/art/swan_face.webp');
      img.alt = '';
      img.width = 30;
      img.height = 30;
      img.decoding = 'async';
      badge.className = 'ti ti--swan';
      badge.textContent = '';
      badge.append(img);
    }
  }

  // my own moments the instant they happen (predicted), the partner's and the farm's when confirmed
  offs.push(store.on('fx', ({ ev, by, local }) => { if (ev && (local || by !== me())) say(ev, by ?? ev.by); }));
  offs.push(store.on('celebrate', ({ ev, by }) => { if (ev && !ev.catchUp) say(ev, by ?? ev.by); }));
  return { dispose() { for (const off of offs) off?.(); } };
}
