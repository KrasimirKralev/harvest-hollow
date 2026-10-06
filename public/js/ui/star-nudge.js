// "Give a nudge to star it on GitHub if they like it" (owner request 2026-10-05). Hosted farms only (multi mode): a
// gentle, one-time card after a happy moment, once the farm has reached level 5 or this device is on its third day of
// play, whichever comes first: "Enjoying Harvest Hollow? A ⭐ on GitHub helps other couples find it" with Star it /
// Maybe later / Don't ask again.
//   - At most twice ever, the second time only after "Maybe later" (closing the card or letting it go counts as that)
//     and at least 3 days after the first.
//   - Never while a panel, a dialog or the photo view is up, during the first-run guides, or in a Golden Hour: it waits
//     for a calm moment (a couple of minutes at most, then the next happy moment tries again).
//   - Remembered per device: localStorage 'hh.starNudge' (a device key, not a farm's) = { days, shown, at, answer }.
//
//   starDue(memo, { now, level }) -> boolean            pure: may the card show now (calm aside)?
//   notePlayDay(memo, day) -> memo                      pure: this device played on `day` ('2026-10-05'); keeps 3
//   calm(signals) -> boolean                            pure: { panel, modal, coach, golden, photo, hidden }
//   createStarNudge(S) -> { check(), show() } | null
import { kv, ensureStylesheet } from './dom.js';
import { farm } from '../net/farm.js';
import { t } from '../i18n/index.js';
import { REPO_URL } from '../front/links.js';
import { levelFromXp } from '../../../shared/content/index.js';
import { goldenHourBp } from '../../../shared/rules/coop.js';
import { coachStep } from './tutorial.js';

export const STAR_KEY = 'hh.starNudge';
export const STAR_LEVEL = 5;
export const STAR_DAYS = 3;
export const STAR_AGAIN_MS = 3 * 86_400_000;
export const STAR_MAX = 2;
const HAPPY_DELAY_MS = 4000;          // after the moment itself (a harvest's sparkle, a level-up's fanfare) has played
const LEVEL_DELAY_MS = 9000;
const CALM_POLL_MS = 2000;
const CALM_GIVE_UP_MS = 2 * 60_000;

const blank = () => ({ days: [], shown: 0, at: 0, answer: null });

/** The stored memo, repaired (an old or hand-edited value never breaks the game). */
export function readMemo(v) {
  const m = { ...blank(), ...(v && typeof v === 'object' ? v : {}) };
  m.days = Array.isArray(m.days) ? m.days.filter((d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(-STAR_DAYS) : [];
  m.shown = Number.isSafeInteger(m.shown) && m.shown >= 0 ? m.shown : 0;
  m.at = Number.isSafeInteger(m.at) ? m.at : 0;
  m.answer = ['later', 'never', 'starred'].includes(m.answer) ? m.answer : null;
  return m;
}

/** The device's local day ('2026-10-05'). */
export const localDay = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function notePlayDay(memo, day) {
  const m = readMemo(memo);
  if (!m.days.includes(day)) m.days = [...m.days, day].sort().slice(-STAR_DAYS);
  return m;
}

export function starDue(memo, { now, level }) {
  const m = readMemo(memo);
  if (m.answer === 'never' || m.answer === 'starred' || m.shown >= STAR_MAX) return false;
  if (m.shown === 1) return m.answer === 'later' && now - m.at >= STAR_AGAIN_MS;
  return level >= STAR_LEVEL || m.days.length >= STAR_DAYS;
}

export const calm = ({ panel, modal, coach, golden, photo, hidden }) => !panel && !modal && !coach && !golden && !photo && !hidden;

export function createStarNudge(S) {
  if (!farm.multi) return null;
  const { store, ui } = S;
  const memo = () => readMemo(kv.get(STAR_KEY));
  const save = (m) => kv.set(STAR_KEY, m);
  const level = () => (store.state ? levelFromXp(store.state.farm.xp) : 0);

  function signals() {
    const doc = globalThis.document;
    const shown = (el) => el && !el.hidden && el.getClientRects().length > 0;
    return {
      panel: Boolean(ui.panels.top()),
      modal: [...doc.querySelectorAll('.modal-layer, dialog[open], .photo-sheet')].some(shown),
      coach: Boolean(store.state && store.pid && coachStep(store.state, store.pid)) || shown(doc.querySelector('#coach-slot .coach')),
      golden: Boolean(store.state && goldenHourBp(store.state, store.now()) > 0),
      photo: doc.body.classList.contains('hud-hidden'),
      hidden: doc.visibilityState === 'hidden',
    };
  }

  function show() {
    const m = memo();
    // counted when it shows: closing it or letting it go reads as "maybe later"
    save({ ...m, shown: m.shown + 1, at: Date.now(), answer: 'later' });
    const answer = (a) => save({ ...memo(), answer: a });
    ui.banner({
      id: 'star-nudge', kind: 'star', ribbon: t('front.game.starRibbon'), message: t('front.game.starText'), ttl: 30_000,
      actions: [
        { label: t('front.game.starIt'), kind: 'sun', fn: () => { answer('starred'); globalThis.open?.(REPO_URL, '_blank', 'noopener'); } },
        { label: t('front.game.later'), kind: 'paper', fn: () => answer('later') },
        { label: t('front.game.never'), kind: 'paper', fn: () => answer('never') },
      ],
    });
  }

  let waitT = 0;
  /** A happy moment: show once it is due and calm (polling briefly for calm), never twice in one wait. */
  function check(delay = HAPPY_DELAY_MS) {
    if (waitT || !starDue(memo(), { now: Date.now(), level: level() })) return;
    ensureStylesheet('/css/ideas.css');            // the card's look, in before it shows
    const until = Date.now() + delay + CALM_GIVE_UP_MS;
    const tick = () => {
      if (!starDue(memo(), { now: Date.now(), level: level() })) { waitT = 0; return; }
      if (calm(signals())) { waitT = 0; show(); return; }
      waitT = Date.now() < until ? setTimeout(tick, CALM_POLL_MS) : 0;
    };
    waitT = setTimeout(tick, delay);
  }

  store.on('welcome', () => save(notePlayDay(memo(), localDay(Date.now()))));
  if (store.state) save(notePlayDay(memo(), localDay(Date.now())));
  store.on('celebrate', ({ ev }) => {
    if (!ev) return;
    if (ev.e === 'levelUp' && ev.scope === 'farm') check(LEVEL_DELAY_MS);
    else if (ev.e === 'questDone' || ev.e === 'achievement' || ev.e === 'together') check();
  });
  // my own harvest or sale: the everyday happy moments
  store.on('fx', ({ ev, local, by }) => {
    if (ev && (ev.e === 'harvested' || ev.e === 'sold') && (local || by === store.pid)) check();
  });
  return { check, show };
}
