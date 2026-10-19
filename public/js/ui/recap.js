// "While you were away" (GDD §5.8 morning recap, §6.2 #18 welcome back, §6.4 "the same feed builds the card"): on the
// welcome (a page load, a reconnect after a laptop sleep), a player who was gone for RECAP_MIN_MS or more gets one card: what ripened, what the
// partner did (feed lines), keepsakes and notes for them, new unlocks (their per-player tour) and story beats. The
// data comes from rules-goals' recap(state, pid, now, extra) (shared/rules/feed.js); this module adds the derived
// lists (ripened counts, unseen levels, unseen beats) and draws the card. ui-shell lane.
//
//   ripenedNow(state, now) -> { crops, animals, trees, trays, total }        (pure; tests)
//   buildRecap(state, pid, now) -> { since, sections }                      (pure; tests)
//
// Release 1.0 (life-feel lane): M10 (ux-first#18) every list shows at most RECAP_LINES lines plus "and N more", and
// "Let's farm!" sits in a sticky footer, so the card fits the owners' evening on a 1366 x 768 screen and an iPhone in
// both orientations; D1 (features#F1) a first section "A surprise for you" ("🎁 Rowan left you a surprise on the
// porch", Show me pans to the box) and "♥ Thanks for everything" under "While you were away", which thanks every
// partner line of the section (the rules' `thank`, within its daily cap).
//   thankable(state, pid, rows) -> feed indexes to thank                    (pure; tests)
// QA r1: L-01 a surprise shelved while away shows the giver's note in quotes; L-08 the surprise line wraps its
// "Show me" under the words on a narrow screen (css/feel.css)
import { CONTENT, STORY_BEATS } from '../../../shared/content/index.js';
import { ACTIONS } from '../../../shared/rules/index.js';
import { recap as rulesRecap } from '../../../shared/rules/feed.js';
import { unseenLevels } from '../../../shared/rules/actions/social.js';
import { unseenBeats } from '../../../shared/rules/actions/quests.js';
import { h, icon, svgIcon, fmt, fmtDuration, playerMark } from './dom.js';
import { feedText, foldGiants, giftNote } from './feed.js';
import { unlocksFor, showMeTarget } from './levelup.js';
import { unlockName } from './hud.js';
import { t, tn, name as cname, ctext } from '../i18n/index.js';
import { lazyImport } from '../net/lazy.js';

// ui-weekly's reader of the Fair / Barge / townsfolk / village state (GDD §5.8: the recap names "the Fair and barge
// status"), loaded with the panels so the shell keeps no static import of them
let weeklyLines = null;
lazyImport('town', () => import('./panels/town.js')).then((m) => { weeklyLines = m.weeklyLines; }).catch(() => {});

/** M10: the lines a recap list shows before "and N more". */
export const RECAP_LINES = 4;

/** D1: the partner lines of "While you were away" that a "Thanks for everything" thanks (not mine, not thanked yet). Pure. */
export function thankable(state, pid, rows) {
  return (rows ?? []).filter((r) => Number.isSafeInteger(r.i) && r.by && r.by !== pid && !r.ty
    && state?.players && Object.hasOwn(state.players, r.by)).map((r) => r.i);
}

/** Away at least this long before the card shows (a reload or a short break says nothing). */
export const RECAP_MIN_MS = 10 * 60_000;

/** True when a welcome at `now` after an absence that began at `lastSeenAt` deserves the card. Pure. */
export function recapDue(lastSeenAt, now, lastShownSince = null) {
  return Number.isFinite(lastSeenAt) && lastSeenAt !== lastShownSince && now - lastSeenAt >= RECAP_MIN_MS;
}

// ---- QA r2 L2-01 (jde#2): a reload is no absence ------------------------------------------------------------------
// lastSeenAt is stamped only when the farmer's last socket closes for good, so a reload (inside the server's grace) or
// 11 minutes of play on a new farm left it where it was, and the card came back on every reload. This device keeps,
// per farmer: `shown`, the absence the card was last shown for, and `here`, when it last saw the farmer here (server
// clock; every 30 s while the page shows, and when it hides or unloads). The absence began at the later of lastSeenAt
// and `here`. Per device in localStorage (in try/catch; without it the module's own memory still guards the page).
const MEM_KEY = 'hh.recap';
const memKey = (st, pid) => `${pid}:${st?.players?.[pid]?.joinedAt ?? 0}`;
function readMem(st, pid) {
  try { return JSON.parse(globalThis.localStorage?.getItem(MEM_KEY) || '{}')?.[memKey(st, pid)] ?? {}; } catch { return {}; }
}
function writeMem(st, pid, patch) {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(MEM_KEY) || '{}') || {};
    all[memKey(st, pid)] = { ...all[memKey(st, pid)], ...patch };
    // a few farmers per device at most: the oldest go
    const keys = Object.keys(all).sort((a, b) => (all[b].here ?? 0) - (all[a].here ?? 0));
    for (const k of keys.slice(6)) delete all[k];
    globalThis.localStorage?.setItem(MEM_KEY, JSON.stringify(all));
  } catch { /* no storage: the module's memory guards this page */ }
}
/** When the absence the farmer is coming back from began, as this device saw it (lastSeenAt or later), or null. */
export function absenceStart(st, pid) {
  const last = st?.players?.[pid]?.lastSeenAt;
  if (!Number.isFinite(last)) return null;
  const here = readMem(st, pid).here;
  return Number.isFinite(here) && here > last ? here : last;
}

/** QA r3 L3-02: a workshop with goods in its tray (a queue item ended by `now`, or compost waiting; never `readyAt`).
 *  Pure. */
export const trayReady = (o, now) => Array.isArray(o?.queue)
  && (o.queue.some((q) => Number.isFinite(q?.e) && q.e <= now) || (Number.isFinite(o.ready) && o.ready > 0));

/** What is ready to collect right now, by kind (a workshop with goods ready counts once, however many). Pure. */
export function ripenedNow(state, now) {
  const r = { crops: 0, animals: 0, trees: 0, trays: 0, total: 0 };
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) {
    const o = objs[id];
    if (o.def === 'plot') { if (o.crop && o.crop.readyAt <= now) r.crops++; continue; }
    if (trayReady(o, now)) { r.trays++; continue; }
    if (!Number.isSafeInteger(o.readyAt) || o.readyAt > now) continue;
    if (typeof o.home === 'string') r.animals++;
    else if (CONTENT.trees.has(o.def)) r.trees++;
    else r.trays++;
  }
  r.total = r.crops + r.animals + r.trees + r.trays;
  return r;
}

/** The recap for `pid` at `now` (since `since`, else their lastSeenAt), sections in RECAP order. Pure. */
export function buildRecap(state, pid, now, since = undefined) {
  const ripened = ripenedNow(state, now);
  const unlocks = [];
  try {
    for (const level of unseenLevels(state, pid)) {
      const u = unlocksFor(level);
      for (const t of u.things) unlocks.push({ level, ...t });
    }
  } catch { /* the rules may not track seen levels on old saves */ }
  let beats = [];
  try { beats = unseenBeats(state, pid).map((id) => STORY_BEATS.find((b) => b.id === id)).filter(Boolean); } catch { beats = []; }
  const r = rulesRecap(state, pid, now, { ripened: ripened.total ? ripened : null, unlocks, beats, ...(Number.isFinite(since) ? { since } : {}) });
  let weekly = [];
  try { weekly = weeklyLines ? weeklyLines(state, pid, now) : []; } catch { weekly = []; }
  // the week's state of play rides along, never a reason to show the card on its own
  if (r.sections.length && weekly.length) r.sections.push({ name: 'weekly', items: weekly });
  return r;
}

// [catalog key, glyph]
const TITLES = {
  surprises: ['cheer.recap.surprises', 'gift'],
  ripened: ['moments.recap.ripened', 'basket'],
  partnerDid: ['moments.recap.partnerDid', null],
  keepsakes: ['moments.recap.keepsakes', 'heart'],
  notes: ['moments.recap.notes', 'note'],
  newUnlocks: ['moments.recap.newUnlocks', 'star'],
  storyBeats: ['moments.recap.storyBeats', 'letter'],
  weekly: ['moments.recap.weekly', 'star'],
};

export function createRecap(S) {
  const { store, ui } = S;
  let lastShownSince = null;          // the absence (absenceStart) the card was last shown for on this page
  let data = null;

  // M10: a list of at most RECAP_LINES lines, then "and N more" (the rest is in the Journal and the feed)
  const more = (n, tag = 'li', key = 'cheer.recap.more') => (n > 0 ? h(`${tag}.recap-more`, tn(key, n)) : null);
  const capped = (items, draw, tag = 'li') => [...items.slice(0, RECAP_LINES).map(draw), more(items.length - RECAP_LINES, tag)];
  const glyphOf = (glyph) => (glyph === 'basket' ? icon('basket', { size: 26 }) : glyph === 'gift' ? icon('gift_box', { size: 26 }) : svgIcon(glyph, 26));
  let closeCard = () => {};

  function section(sec) {
    const [key, glyph] = TITLES[sec.name] || [null, 'star'];
    const head = h('h3', glyph ? glyphOf(glyph) : null, key ? t(key) : sec.name);
    const st = store.state;
    switch (sec.name) {
      case 'surprises': {
        // D1: what is inside stays a surprise; Show me pans the farm to the box on the porch
        return h('section.recap-surprise', head, h('ul', capped(sec.items, (g) => {
          const by = st.players[g.by];
          const box = st.farm.objects[g.id];
          return h('li', icon('gift_box', { size: 26 }), h('span', t('cheer.recap.surprise', { name: by?.name ?? t('common.partner') })),
            box ? h('button.btn.btn--sky.btn--small', { type: 'button', on: { click: () => { closeCard(); S.view?.focus?.(box.x + 0.5, box.z + 0.5); } } }, t('moments.showMe')) : null);
        })));
      }
      case 'ripened': {
        const r = sec.items;
        const bits = [r.crops && tn('moments.recap.crops', r.crops), r.animals && tn('moments.recap.animals', r.animals),
          r.trees && tn('moments.recap.trees', r.trees), r.trays && tn('moments.recap.trays', r.trays)].filter(Boolean);
        return h('section', head, h('p.body', { style: 'margin:0' }, t('moments.recap.waited', { list: bits.join(', ') })));
      }
      case 'partnerDid': {
        // the newest lines first in view: the last RECAP_LINES of the folded list, "N earlier" above them (L4-05)
        const rows = foldGiants(sec.items).slice(-8);
        const shown = rows.slice(-RECAP_LINES);
        const lines = [more(rows.length - shown.length, 'li', 'cheer.recap.earlier'), ...shown.map((row) => {
          // (a shelved surprise's note is quoted once, under "Gifts on your shelf")
          const ft = feedText(row, st, store.pid, { notes: false });
          const p = st.players[row.by];
          const glyph = row.k === 'quest' ? 'letter' : row.k === 'level' ? 'star' : row.k === 'name' ? 'note' : 'sprout';
          return h('li', p ? playerMark(row.by, p) : null,
            ft.icon ? icon(ft.icon, { size: 26 }) : svgIcon(glyph, 26), h('span', h('b', ft.actor), ` ${ft.text}`));
        })];
        // D1: one tap thanks every partner line of the section (the rules' thank, within its daily cap)
        const todo = thankable(st, store.pid, sec.items);
        const thanks = todo.length && ACTIONS.thank ? h('button.btn.btn--paper.btn--small.recap-thanks', { type: 'button', on: { click: () => {
          for (const i of todo) S.controller.do('thank', { i });
          thanks.disabled = true;
          thanks.textContent = t('cheer.recap.thanked');
        } } }, t('cheer.recap.thanks')) : null;
        return h('section', head, h('ul', lines), thanks);
      }
      case 'keepsakes': {
        // QA r1 L-01: a surprise the farm shelved while its recipient was away still carries the giver's note: those
        // gifts are lines with the note in quotes (it reached no screen before); the rest stay icon cells
        const named = (k) => (CONTENT.items.get(k.item) ? cname(k.item, { family: 'items' }) : k.item);
        const rows = sec.items.map((k) => ({ k, note: giftNote(st, { ...k, from: k.from ?? k.by, to: k.to ?? store.pid }) }));
        const cells = rows.filter((x) => !x.note).map((x) => x.k);
        const noted = rows.filter((x) => x.note);
        return h('section', head,
          cells.length ? h('div.grid', capped(cells, (k) => h('div.cell', icon(k.item, { size: 44 }), named(k)), 'div')) : null,
          noted.length ? h('ul.recap-notes', capped(noted, ({ k, note }) => h('li', icon(k.item, { size: 26 }),
            h('span', h('b', named(k)), ' ', h('span.recap-quote', t('cheer.gift.quote', { note })))))) : null);
      }
      case 'notes':
        return h('section', head, h('ul', capped(sec.items, (n) => h('li', svgIcon('note', 22),
          h('span', h('b', st.players[n.by]?.name ?? t('moments.recap.note')), t('moments.recap.noteText', { text: n.text }))))));
      case 'newUnlocks':
        // the names are said now (the card's data was worked out at the welcome, maybe in the other language)
        return h('section', head, h('div.grid', capped(sec.items, (u) => h('div.cell', u.icon ? icon(u.icon, { size: 44 }) : svgIcon('star', 44),
          u.family && u.id ? unlockName(u) : u.name), 'div')));
      case 'storyBeats':
        return h('section', head, h('ul', capped(sec.items, (b) => h('li', svgIcon('letter', 24),
          h('span', h('b', ctext('STORY_BEATS', b.id, 'title', b.title)), t('moments.recap.beatText', { text: ctext('STORY_BEATS', b.id, 'text', b.text) }))))));
      case 'weekly': {
        // the week's lines are read again as the card is drawn (a language switch re-mounts it): words of the moment
        let lines = sec.items;
        try { const now = weeklyLines ? weeklyLines(st, store.pid, store.now()) : null; if (now && now.length) lines = now; } catch { /* keep the welcome's */ }
        return h('section', head, h('ul', capped(lines, (l) => h('li', icon(l.icon, { size: 24 }), h('span', l.text)))));
      }
      default:
        return null;
    }
  }

  ui.panels.register('recap', {
    get title() { return t('moments.recap.title'); },
    size: 'wide',
    modal: true,
    mount(body, ctx) {
      const d = data || buildRecap(store.state, store.pid, store.now());
      const away = store.now() - d.since;
      const me = store.state.players[store.pid];
      const lead = h('p.hello', me ? t('moments.recap.hello', { name: me.name, d: fmtDuration(away, { cut: 'ms<10' }) })
        : t('moments.recap.helloAny', { d: fmtDuration(away, { cut: 'ms<10' }) }));
      const done = () => {
        // the tour of new unlocks counts as seen once the card is closed (per player, in the rules)
        const lvl = Math.max(0, ...d.sections.filter((s) => s.name === 'newUnlocks').flatMap((s) => s.items.map((u) => u.level)));
        if (lvl > 0 && ACTIONS.markSeen) S.controller.do('markSeen', { kind: 'level', level: lvl });
        for (const s of d.sections) {
          if (s.name === 'storyBeats' && ACTIONS.markSeen) for (const b of s.items) S.controller.do('markSeen', { kind: 'beat', id: b.id });
        }
        ctx.close();
      };
      closeCard = done;
      const news = d.sections.find((x) => x.name === 'newUnlocks');
      const pick = () => (news ? news.items.map((u) => showMeTarget(u, store.state)).find((x) => x && ui.panels.has(x.panel)) : null);
      const showNew = (f) => h('button.btn.btn--sky', { type: 'button', on: { click: () => { done(); ui.panels.open(f.panel, f.args); } } }, t('moments.recap.showNew'));
      const first = pick();
      // M10: the buttons in a footer that stays in view however long the card is
      const foot = h('div.acts.recap-foot', first ? showNew(first) : null, h('button.btn', { type: 'button', on: { click: done } }, t('moments.recap.farm')));
      body.append(h('div.recap', lead, ...d.sections.map(section).filter(Boolean), foot));
      // (QA r4) a panel that registers after the card opened (the lazy Market on a slow link) brings its Show me then
      if (news && !first) {
        const off = ui.panels.on?.('register', () => {
          const f = foot.isConnected && !foot.querySelector('.btn--sky') ? pick() : null;
          if (f) foot.prepend(showNew(f));
          if (f || !foot.isConnected) off?.();
        });
      }
    },
  });

  /**
   * On every welcome: show the card for an absence of RECAP_MIN_MS or more that it has not been shown for yet, on this
   * device (L2-01). A reconnect after a laptop sleep is a welcome too (QA wave 1 UI-12).
   */
  function onWelcome() {
    if (!store.state) return;
    const me = store.state.players[store.pid];
    if (!me || !me.lastSeenAt) return;
    const since = absenceStart(store.state, store.pid);
    const shown = readMem(store.state, store.pid).shown;
    if (since === lastShownSince || since === shown) return;
    const now = store.now();
    if (!recapDue(since, now, lastShownSince)) return;
    try { data = buildRecap(store.state, store.pid, now, since); } catch (err) { console.warn('recap failed', err); return; }
    if (!data.sections.length) return;
    lastShownSince = since;
    writeMem(store.state, store.pid, { shown: since });
    setTimeout(() => { if (!ui.panels.top()) ui.panels.open('recap'); }, 900);
  }
  // L2-01: this device saw the farmer here (every 30 s while the page shows, and as it hides or unloads)
  const stamp = () => { if (store.state && store.pid && store.state.players?.[store.pid]) writeMem(store.state, store.pid, { here: store.now() }); };
  const tick = setInterval(() => { if (globalThis.document?.visibilityState !== 'hidden') stamp(); }, 30_000);
  tick?.unref?.();
  globalThis.addEventListener?.('pagehide', stamp);
  globalThis.document?.addEventListener?.('visibilitychange', () => { if (document.visibilityState === 'hidden') stamp(); });

  return { onWelcome, build: () => buildRecap(store.state, store.pid, store.now()) };
}
