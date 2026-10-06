// "While you were away" (GDD §5.8 morning recap, §6.2 #18 welcome back, §6.4 "the same feed builds the card"): on the
// welcome (a page load, a reconnect after a laptop sleep), a player who was gone for RECAP_MIN_MS or more gets one card: what ripened, what the
// partner did (feed lines), keepsakes and notes for them, new unlocks (their per-player tour) and story beats. The
// data comes from rules-goals' recap(state, pid, now, extra) (shared/rules/feed.js); this module adds the derived
// lists (ripened counts, unseen levels, unseen beats) and draws the card. ui-shell lane.
//
//   ripenedNow(state, now) -> { crops, animals, trees, trays, total }        (pure; tests)
//   buildRecap(state, pid, now) -> { since, sections }                      (pure; tests)
import { CONTENT, STORY_BEATS } from '../../../shared/content/index.js';
import { ACTIONS } from '../../../shared/rules/index.js';
import { recap as rulesRecap } from '../../../shared/rules/feed.js';
import { unseenLevels } from '../../../shared/rules/actions/social.js';
import { unseenBeats } from '../../../shared/rules/actions/quests.js';
import { h, icon, svgIcon, fmt, fmtDuration, playerMark } from './dom.js';
import { feedText, foldGiants } from './feed.js';
import { unlocksFor, showMeTarget } from './levelup.js';
import { unlockName } from './hud.js';
import { t, tn, name as cname, ctext } from '../i18n/index.js';

// ui-weekly's reader of the Fair / Barge / townsfolk / village state (GDD §5.8: the recap names "the Fair and barge
// status"), loaded with the panels so the shell keeps no static import of them
let weeklyLines = null;
import('./panels/town.js').then((m) => { weeklyLines = m.weeklyLines; }).catch(() => {});

/** Away at least this long before the card shows (a reload or a short break says nothing). */
export const RECAP_MIN_MS = 10 * 60_000;

/** True when a welcome at `now` after an absence that began at `lastSeenAt` deserves the card. Pure. */
export function recapDue(lastSeenAt, now, lastShownSince = null) {
  return Number.isFinite(lastSeenAt) && lastSeenAt !== lastShownSince && now - lastSeenAt >= RECAP_MIN_MS;
}

/** What is ready to collect right now, by kind. Pure. */
export function ripenedNow(state, now) {
  const r = { crops: 0, animals: 0, trees: 0, trays: 0, total: 0 };
  const objs = state.farm.objects;
  for (const id of Object.keys(objs)) {
    const o = objs[id];
    if (o.def === 'plot') { if (o.crop && o.crop.readyAt <= now) r.crops++; continue; }
    if (!Number.isSafeInteger(o.readyAt) || o.readyAt > now) continue;
    if (typeof o.home === 'string') r.animals++;
    else if (CONTENT.trees.has(o.def)) r.trees++;
    else r.trays++;
  }
  r.total = r.crops + r.animals + r.trees + r.trays;
  return r;
}

/** The recap for `pid` at `now`, sections in RECAP order. Pure. */
export function buildRecap(state, pid, now) {
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
  const r = rulesRecap(state, pid, now, { ripened: ripened.total ? ripened : null, unlocks, beats });
  let weekly = [];
  try { weekly = weeklyLines ? weeklyLines(state, pid, now) : []; } catch { weekly = []; }
  // the week's state of play rides along, never a reason to show the card on its own
  if (r.sections.length && weekly.length) r.sections.push({ name: 'weekly', items: weekly });
  return r;
}

// [catalog key, glyph]
const TITLES = {
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
  let lastShownSince = null;          // the absence (players[me].lastSeenAt) the card was last shown for
  let data = null;

  function section(sec) {
    const [key, glyph] = TITLES[sec.name] || [null, 'star'];
    const head = h('h3', glyph ? (glyph === 'basket' ? icon('basket', { size: 26 }) : svgIcon(glyph, 26)) : null, key ? t(key) : sec.name);
    const st = store.state;
    switch (sec.name) {
      case 'ripened': {
        const r = sec.items;
        const bits = [r.crops && tn('moments.recap.crops', r.crops), r.animals && tn('moments.recap.animals', r.animals),
          r.trees && tn('moments.recap.trees', r.trees), r.trays && tn('moments.recap.trays', r.trays)].filter(Boolean);
        return h('section', head, h('p.body', { style: 'margin:0' }, t('moments.recap.waited', { list: bits.join(', ') })));
      }
      case 'partnerDid':
        return h('section', head, h('ul', foldGiants(sec.items).slice(-8).map((row) => {
          const ft = feedText(row, st, store.pid);
          const p = st.players[row.by];
          const glyph = row.k === 'quest' ? 'letter' : row.k === 'level' ? 'star' : row.k === 'name' ? 'note' : 'sprout';
          return h('li', p ? playerMark(row.by, p) : null,
            ft.icon ? icon(ft.icon, { size: 26 }) : svgIcon(glyph, 26), h('span', h('b', ft.actor), ` ${ft.text}`));
        })));
      case 'keepsakes':
        return h('section', head, h('div.grid', sec.items.map((k) => h('div.cell', icon(k.item, { size: 44 }),
          CONTENT.items.get(k.item) ? cname(k.item, { family: 'items' }) : k.item))));
      case 'notes':
        return h('section', head, h('ul', sec.items.slice(0, 4).map((n) => h('li', svgIcon('note', 22),
          h('span', h('b', st.players[n.by]?.name ?? t('moments.recap.note')), t('moments.recap.noteText', { text: n.text }))))));
      case 'newUnlocks':
        // the names are said now (the card's data was worked out at the welcome, maybe in the other language)
        return h('section', head, h('div.grid', sec.items.slice(0, 10).map((u) => h('div.cell', u.icon ? icon(u.icon, { size: 44 }) : svgIcon('star', 44),
          u.family && u.id ? unlockName(u) : u.name))));
      case 'storyBeats':
        return h('section', head, h('ul', sec.items.map((b) => h('li', svgIcon('letter', 24),
          h('span', h('b', ctext('STORY_BEATS', b.id, 'title', b.title)), t('moments.recap.beatText', { text: ctext('STORY_BEATS', b.id, 'text', b.text) }))))));
      case 'weekly': {
        // the week's lines are read again as the card is drawn (a language switch re-mounts it): words of the moment
        let lines = sec.items;
        try { const now = weeklyLines ? weeklyLines(st, store.pid, store.now()) : null; if (now && now.length) lines = now; } catch { /* keep the welcome's */ }
        return h('section', head, h('ul', lines.map((l) => h('li', icon(l.icon, { size: 24 }), h('span', l.text)))));
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
      const news = d.sections.find((x) => x.name === 'newUnlocks');
      const first = news ? news.items.map((u) => showMeTarget(u, store.state)).find((x) => x && ui.panels.has(x.panel)) : null;
      body.append(h('div.recap', lead, ...d.sections.map(section).filter(Boolean),
        h('div.acts',
          first ? h('button.btn.btn--sky', { type: 'button', on: { click: () => { done(); ui.panels.open(first.panel, first.args); } } }, t('moments.recap.showNew')) : null,
          h('button.btn', { type: 'button', on: { click: done } }, t('moments.recap.farm')))));
    },
  });

  /**
   * On every welcome: show the card for an absence of RECAP_MIN_MS or more that it has not been shown for yet. A
   * reconnect after a laptop sleep is a welcome too (the card used to show once per page load; QA wave 1 UI-12).
   */
  function onWelcome() {
    if (!store.state) return;
    const me = store.state.players[store.pid];
    if (!me || !me.lastSeenAt || me.lastSeenAt === lastShownSince) return;
    const now = store.now();
    if (!recapDue(me.lastSeenAt, now, lastShownSince)) return;
    try { data = buildRecap(store.state, store.pid, now); } catch (err) { console.warn('recap failed', err); return; }
    if (!data.sections.length) return;
    lastShownSince = me.lastSeenAt;
    setTimeout(() => { if (!ui.panels.top()) ui.panels.open('recap'); }, 900);
  }

  return { onWelcome, build: () => buildRecap(store.state, store.pid, store.now()) };
}
