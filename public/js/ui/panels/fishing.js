// The Fishing Dock (GDD §6.2 mechanic 21, v2 A4; M2; w3 ui-home lane): "both avatars sit on the dock: a calm 20-s
// timing cast, once per hour each. Catches are Pond Treasures (collection), cosmetic fish trophies for the dock and a
// weekly biggest-fish photo, never an economy item". The cast itself is played at the dock (the client lane's
// game/fishing.js: walk there, sit, wait for the bite, hook it); this panel is the dock's board: when each of you may
// cast again, who has a line in the water, the trophy board (the biggest of every fish and who landed it), the week's
// biggest fish (the Sunday photo), the Pond Treasures found so far and what fishing together brings.
//
//   fishingView(state, pid, now) -> plain data (tested in node)     fishingPanel: the 'fishing' panel (args {})
//   spotName(spot) -> words for a fishing spot ({ pond } | { id })
//
// Rules (rules-economy, shared/rules/actions/fishing.js): cast {id? | pond?}, reel {}; fishingLive, fishingSpots,
// nextCastAt, lineOf, trophyBoard; state players[pid].fish { cast, at, day }, farm.fishing { records, week, n }.
import { FISHING, expansionOf, isLive } from '../../../../shared/content/index.js';
import * as fishA from '../../../../shared/rules/actions/fishing.js';
import { dayIndex, weekIndex } from '../../../../shared/rules/calendar.js';
import { sortedKeys } from '../../../../shared/rules/order.js';
import { levelOf } from './core.js';
import { albumView, stickerArt } from './collections.js';
import { h, fmt, createKit, svgIcon, playerMark, fill, ago, phoneTitle } from './kit.js';
import { fishArt, pondScene, careGlyph } from './home-art.js';
import { t, ctext, name as cname } from '../../i18n/index.js';
import { tParts } from './kit.js';

/** Words for a fishing spot: the expansion's pond ("Willow Pond") or a placed Fishing Dock. */
export function spotName(spot) {
  if (!spot) return t('home.fish.spot.dock');
  if (spot.pond) return expansionOf(spot.pond) ? cname(spot.pond, { family: 'expansions' }) : t('home.fish.spot.pond');
  return t('home.fish.spot.fishingDock');
}

/** A fish's name in the language in effect (lane B: FISHING['fish.<id>'].name). */
const fishName = (id, english) => ctext('FISHING', `fish.${id}`, 'name', english);

/** A spot from its key in the rules' records (an expansion id for a pond, else a dock object id). */
export const spotOfKey = (key) => (typeof key !== 'string' ? null : expansionOf(key) ? { pond: key } : { id: key });

const isLiveNow = (state) => (typeof fishA.fishingLive === 'function' ? fishA.fishingLive(state)
  : Boolean(FISHING) && isLive(FISHING) && levelOf(state) >= FISHING.unlock);

/** Everything the dock's board shows. Pure. */
export function fishingView(state, pid, now) {
  const live = isLiveNow(state);
  const spots = live && typeof fishA.fishingSpots === 'function' ? fishA.fishingSpots(state) : [];
  const nextAt = (p) => (typeof fishA.nextCastAt === 'function' ? fishA.nextCastAt(state, p) : 0);
  const lineOf = (p) => (typeof fishA.lineOf === 'function' ? fishA.lineOf(state, p) : null);
  const players = sortedKeys(state.players).sort((a, b) => (a === pid ? -1 : b === pid ? 1 : 0)).map((p) => {
    const at = nextAt(p);
    const line = lineOf(p);
    return { pid: p, me: p === pid, name: state.players[p].name, color: state.players[p].color, nextAt: at, ready: now >= at,
      line: line ? { spot: line.spot, at: line.at } : null };
  });
  const hue = new Map((FISHING?.fish ?? []).map((f) => [f.id, f]));
  const board = (typeof fishA.trophyBoard === 'function' ? fishA.trophyBoard(state)
    : (FISHING?.fish ?? []).map((f) => ({ id: f.id, name: f.name, cm: f.cm, record: state.farm.fishing?.records?.[f.id] ?? null })))
    .map((r) => ({ ...r, name: fishName(r.id, r.name), hue: hue.get(r.id)?.hue ?? '#9DA9B0', joke: Boolean(hue.get(r.id)?.joke) }));
  const F = state.farm.fishing ?? null;
  const week = weekIndex(dayIndex(now, state.meta.tz));
  const best = F && F.week && F.week.n === week && F.week.best ? { ...F.week.best, name: fishName(F.week.best.fish, hue.get(F.week.best.fish)?.name ?? F.week.best.fish),
    hue: hue.get(F.week.best.fish)?.hue ?? '#9DA9B0' } : null;
  let treasures = null;
  try {
    const set = albumView(state, pid).sets.find((x) => x.id === FISHING?.collectionSet);
    if (set) treasures = { id: set.id, name: set.name, items: set.items, found: set.found, total: set.total, done: set.done };
  } catch { treasures = null; }
  const spotsNamed = spots.map((x) => ({ ...x, name: spotName(x) }));
  return {
    live, unlock: FISHING?.unlock ?? 21, dockFrom: FISHING?.spots?.decorFrom ?? 28, level: levelOf(state), spots: spotsNamed,
    players, me: players.find((p) => p.me) ?? null, board, caught: board.filter((r) => r.record).length, best, total: F?.n ?? 0,
    treasures, togetherMin: Math.round((FISHING?.together?.windowMs ?? 20_000) / 1000), cooldownMin: Math.round((FISHING?.cooldownMs ?? 3_600_000) / 60_000),
    castSec: Math.round((FISHING?.castMs ?? 20_000) / 1000),
  };
}

/** The dock's badge: '!' when there is a spot and my hourly cast is ready. */
export function fishingBadge(state, pid, now) {
  const v = fishingView(state, pid, now);
  return v.live && v.spots.length && v.me && v.me.ready && !v.me.line ? '!' : null;
}

// ---- the panel ------------------------------------------------------------------------------------------------------

/** Start the cast at the dock: the client's fishing flow when this build has it, else a hint where to tap. */
function goFishing(ctx, spot) {
  const f = ctx.controller?.fishing ?? globalThis.__hh?.fishing ?? null;
  if (f && typeof f.start === 'function') {
    const target = spot.pond ? { pond: spot.pond } : spot.id;
    let r = null;
    try { r = f.start(target); } catch (err) { console.error('fishing start failed', err); }
    if (r && r.ok === false) { ctx.ui.toast(r.code || t('home.fish.cant')); return; }
    ctx.close();
    return;
  }
  ctx.ui.toast(t('home.fish.walkTo', { spot: spotName(spot) }));
}

function rodCard(ctx, kit, v) {
  const me = v.me;
  if (!me) return null;
  const spot = v.spots[0];
  const st = ctx.store.state;
  let status;
  if (me.line) status = h('p.fi-status', careGlyph('fish', 26), t('home.fish.lineIn', { spot: spotName(spotOfKey(me.line.spot)) }));
  else if (!me.ready) status = h('p.fi-status', svgIcon('sun', 24), kit.timer(h('span'), { end: me.nextAt, prefix: t('home.fish.nextIn'), doneText: t('home.fish.rodReady'), done: () => ctx.refreshFishing?.() }));
  else status = h('p.fi-status.ready', careGlyph('fish', 26), t('home.fish.ready'));
  const partner = v.players.filter((p) => !p.me).map((p) => h('p.fi-partner', playerMark(p.pid, st.players[p.pid], { size: 20 }),
    p.line ? t('home.fish.partnerLine', { name: p.name, n: v.togetherMin })
      : p.ready ? t('home.fish.partnerReady', { name: p.name }) : h('span', `${p.name}: `, kit.timer(h('span'), { end: p.nextAt, prefix: t('home.fish.partnerNext') }))));
  return h('section.fi-rod',
    status, ...partner,
    spot ? h('div.fi-go', ...v.spots.slice(0, 2).map((x) => h('button.btn.btn--sky', { type: 'button', dataset: { fish: x.pond ?? x.id },
      'aria-disabled': me.ready ? null : 'true', title: me.ready ? null : t('home.fish.rests'),
      on: { click: () => { if (me.ready) goFishing(ctx, x); } } }, careGlyph('fish', 24), t('home.fish.fishAt', { spot: x.name }))))
      : h('p.hm-note', t('home.fish.noSpot', { n: v.dockFrom })),
    h('small.fi-how', t('home.fish.how')));
}

function boardCard(v, st, me) {
  return h('section.fi-board', h('h3', t('home.fish.board')), h('small', t('home.fish.boardSub', { caught: v.caught, n: v.board.length, total: v.total })),
    h('ul', ...v.board.map((r) => h(`li.fi-trophy${r.record ? '.got' : ''}${r.joke ? '.joke' : ''}`, { dataset: { fish: r.id } },
      fishArt(r.id, r.hue, { size: 60, caught: Boolean(r.record), label: r.record ? t('home.fish.sized', { name: r.name, cm: r.record.cm }) : t('home.fish.notYet', { name: r.name }) }),
      h('b', r.name),
      r.record ? h('small', tParts('home.fish.record', { cm: r.record.cm,
        mark: st.players[r.record.by] ? playerMark(r.record.by, st.players[r.record.by], { size: 14 }) : '',
        who: r.record.by === me ? t('home.fish.you') : st.players[r.record.by]?.name ?? t('home.fish.aFarmer') }))
        : h('small', t('home.fish.range', { a: r.cm[0], b: r.cm[1] }))))));
}

export const fishingPanel = {
  title: () => phoneTitle('home.fish.title', 'home.fish.titleShort'),
  icon: 'pond_dock',
  size: 'wide',
  topics: ['players', 'fishing', 'album', 'xp', 'objects', 'expansions'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const sig = () => {
      const v = fishingView(ctx.store.state, ctx.store.pid, ctx.now());
      return [v.live, v.spots.map((x) => x.name), v.players.map((p) => [p.pid, p.ready, Boolean(p.line), p.nextAt]),
        v.board.map((r) => r.record && r.record.cm), v.best && [v.best.fish, v.best.cm], v.total, v.treasures && v.treasures.found];
    };
    const update = kit.memo(body, sig, render);
    ctx.refreshFishing = () => update(true);
    ctx.every(5_000, () => update());
    function render() {
      const st = ctx.store.state;
      const v = fishingView(st, ctx.store.pid, ctx.now());
      if (!v.live) {
        fill(body, h('div.br-locked', careGlyph('fish', 64), h('p', FISHING && isLive(FISHING)
          ? t('home.fish.opensWith', { n: v.unlock }) : t('home.fish.nextChapter'))));
        return;
      }
      const seats = v.players.filter((p) => p.line).map((p) => ({ color: p.color, mark: (p.name || '?').slice(0, 1).toUpperCase(), line: true }));
      const best = v.best ? h('section.fi-best', h('h3', t('home.fish.biggest')),
        h('div.fi-best-row', fishArt(v.best.fish, v.best.hue, { size: 96, label: v.best.name }),
          h('div', h('b', t('home.fish.sized', { name: v.best.name, cm: v.best.cm })), h('small', tParts('home.fish.landedBy', {
            mark: st.players[v.best.by] ? playerMark(v.best.by, st.players[v.best.by], { size: 14 }) : '',
            who: v.best.by === ctx.store.pid ? t('home.fish.you') : st.players[v.best.by]?.name ?? t('home.fish.aFarmer'), ago: ago(ctx.now() - v.best.at) })),
          h('small', t('home.fish.sunday')))))
        : h('section.fi-best.none', h('h3', t('home.fish.biggest')), h('p', t('home.fish.noneYet')));
      const tr = v.treasures ? h('section.fi-treasures', h('h3', v.treasures.name), h('small', t('home.fish.treasures', { found: v.treasures.found, total: v.treasures.total })),
        h('ul', ...v.treasures.items.map((it) => h(`li${it.found ? '.got' : ''}`, { title: it.found ? it.name : t('home.fish.notFound') },
          stickerArt(v.treasures.id, it.id, 52), h('small', it.found ? it.name : '?')))),
        h('button.pn-chipbtn', { type: 'button', on: { click: () => ctx.open('collections', { set: v.treasures.id }) } }, t('farm.unlock.collections.label'))) : null;
      fill(body,
        h('div.fi-top', h('div.fi-scene', pondScene({ seats, label: seats.length ? t('home.fish.sceneBusy') : t('home.fish.sceneQuiet') })), rodCard(ctx, kit, v)),
        h('div.fi-mid', best, tr),
        boardCard(v, st, ctx.store.pid),
        h('p.fi-together', svgIcon('heart', 22), t('home.fish.together', { n: v.togetherMin })));
      kit.refresh();
    }
    update(true);
    return { update: () => { update(); kit.refresh(); } };
  },
};
