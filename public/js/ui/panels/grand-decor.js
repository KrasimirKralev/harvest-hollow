// Grand decor (GDD §3.8, v2 H4; w3 ui-home lane): the ten showcase pieces from the Old Dutch Windmill (L20) to the
// Golden Farm Gate (L40), priced in hours of income at their level. The showroom shows each piece on its plinth with
// its beauty, its effect (Golden Hour seats, bee forage x3, the gate with the farm's name), what it would do to Farm
// Beauty right now (the score, a new star and its Acorns, Showcase points past five stars) and how long the couple
// farms for it. Buying is the rules' `place` (build mode); a piece can be saved for on the Wishlist.
//
//   grandView(state, { now, pid }) -> plain data (tested in node)   grandDecorPanel: the 'grandDecor' panel (args { focus? })
//   grandStrip(ctx) -> element | null    a small "Grand decor" strip for the Market's Decor tab (ui-panels hook)
import { CONTENT, isLive, levelRow, FARM_BEAUTY, SAFETY } from '../../../../shared/content/index.js';
import * as decorA from '../../../../shared/rules/actions/decor.js';
import * as beautyA from '../../../../shared/rules/actions/beauty.js';
import { levelOf, bigSpend, inTray } from './model.js';
import { probe, passes } from './core.js';
import { I } from './intents.js';
import { startPlacement } from './placement.js';
import { h, fmt, createKit, price, icon, svgIcon, ribbonTag, fill, tParts, phoneTitle } from './kit.js';
import { t, ctext, name as cname } from '../../i18n/index.js';

/** The ten pieces in level order (live or not: a later chapter's piece is shown as "coming"). */
export const grandDefs = () => [...CONTENT.decor.values()].filter((d) => d.tier === 'grand').sort((a, b) => a.unlock - b.unlock || (a.id < b.id ? -1 : 1));

const placedCount = (state, defId) => Object.values(state.farm.objects).filter((o) => o.def === defId).length;

/**
 * Hours of farming a price is worth at a level (E(L) = coins per hour of play of the reference couple, GDD §4.4),
 * rounded to the half hour. null without an income row.
 */
export function hoursOf(coins, level) {
  const E = levelRow(level)?.E;
  if (!E || !(coins > 0)) return null;
  return Math.max(0.5, Math.round((coins / E) * 2) / 2);
}

/**
 * Everything the showroom draws. Pure. pieces[i]: { id, name, unlock, size, beauty, text, effect, live, owned, placed,
 * tray, code, hint, price, big, hours, gain, after: { score, stars, acorns, showcase } | null }.
 */
export function grandView(state, env = {}) {
  const level = levelOf(state);
  const now = env.now ?? Infinity;
  const live = beautyA.beautyLive ? beautyA.beautyLive(state) : false;
  const b = live ? beautyA.beautyOf(state, now) : null;
  const B = FARM_BEAUTY;
  const pieces = grandDefs().map((d) => {
    const isOn = isLive(d);
    const placed = placedCount(state, d.id);
    const tray = inTray(state, d.id);
    const owned = placed + tray;
    const bp = decorA.buyPrice(state, d.id);
    const cost = { coins: d.cost ?? 0, acorns: d.acorns ?? 0 };
    let code = bp.code;
    let hint = {};
    if (!isOn) { code = 'LOCKED'; hint = { text: t('home.grand.later') }; }
    else if (code === 'LOCKED') hint = { unlock: d.unlock };
    else if (tray > 0) { code = null; }
    else if (code === null && cost.coins > state.farm.wallet.coins) { code = 'NO_COINS'; hint = { coins: cost.coins - state.farm.wallet.coins }; }
    // the next copy's beauty: 100 %, 50 % for the second, 25 % after (GDD §3.8); path and set bonuses come on top
    const copyBp = B.copyBp[Math.min(placed, B.copyBp.length - 1)];
    const gain = Math.floor(((d.beauty10 ?? 0) * copyBp) / 100_000);
    let after = null;
    if (b) {
      const score = b.score + gain;
      const stars = beautyA.starsFor(score);
      after = { score, stars, newStars: Math.max(0, stars - b.stars), acorns: Math.max(0, stars - Math.max(b.stars, state.farm.beauty?.stars ?? 0)) * B.starAcorns,
        showcase: score > B.stars[B.stars.length - 1] ? Math.min(gain, score - B.stars[B.stars.length - 1]) : 0 };
    }
    return { id: d.id, name: cname(d.id), unlock: d.unlock, size: d.size, beauty: (d.beauty10 ?? 0) / 10, text: ctext('decor', d.id, 'desc', d.text), textEn: d.text, effect: d.effect,
      live: isOn, placed, tray, owned, code, hint, price: cost, big: tray === 0 && code === null && bigSpend(state, cost.coins, cost.acorns, env),
      hours: hoursOf(cost.coins, Math.max(level, 1)), gain, after, isNew: isOn && d.unlock === level };
  });
  const open = pieces.filter((p) => p.live && level >= p.unlock);
  return { level, beauty: b ? { score: b.score, stars: b.stars, next: b.next } : null, pieces, open: open.length,
    owned: pieces.filter((p) => p.owned > 0).length, live: pieces.some((p) => p.live),
    first: pieces.find((p) => p.live)?.unlock ?? null };
}

// ---- the panel --------------------------------------------------------------------------------------------------

const SEAT = (e) => (e && e.seats ? t('home.grand.seat') : null);

function wishBtn(ctx, p) {
  const st = ctx.store.state;
  if (levelOf(st) < SAFETY.wishlist.unlock || !p.live || p.code === 'LOCKED') return null;
  const it = I.wish(p.id);
  const wished = Object.values(st.farm.wishlist ?? {}).some((w) => w.def === p.id);
  if (!wished && !passes(probe(ctx.store, it.type, it.args))) return null;
  return h('button.pn-wishbtn', { type: 'button', 'aria-pressed': String(wished), 'aria-label': t('market.wish.aria', { item: p.name }),
    title: wished ? t('market.wish.on') : t('market.wish.save'), dataset: { wish: p.id },
    on: { click: (e) => {
      e.stopPropagation();
      if (wished) { ctx.open('wishlist'); return; }
      const r = ctx.act(it.type, it.args);
      if (r && r.ok) ctx.ui.toast(t('market.wish.added', { item: p.name }));
    } } }, wished ? '♥' : '♡');
}

function previewLine(p, v) {
  if (!p.after || !v.beauty || p.code === 'LOCKED') return null;
  const a = p.after;
  const bits = [h('span', tParts('home.grand.preview', { score: v.beauty.score, b: h('b', fmt(a.score)) }))];
  if (a.newStars > 0) bits.push(h('span.hg-star', `${'★'.repeat(a.stars)}${a.acorns ? t('home.grand.plusAcorns', { n: a.acorns }) : ''}`));
  else if (a.showcase > 0) bits.push(h('span.hg-star', t('home.grand.showcase', { n: a.showcase })));
  return h('p.hg-preview', { title: t('home.grand.previewTip') }, ...bits);
}

function pieceCard(ctx, kit, p, v) {
  const locked = p.code === 'LOCKED';
  const art = h('div.hg-plinth', icon(p.id, { size: 112, alt: '' }),
    locked ? h('span.pn-lock', svgIcon('lock', 18), p.live ? t('common.level', { n: p.unlock }) : t('home.grand.soon')) : null,
    !locked && p.isNew ? ribbonTag(t('market.card.new'), 'pn-new') : null,
    p.owned ? ribbonTag(p.tray ? t('market.card.trayN', { n: p.tray }) : p.placed > 1 ? t('home.grand.nOnFarm', { n: p.placed }) : t('market.card.onFarm'), 'pn-free-tag') : null,
    wishBtn(ctx, p));
  const facts = h('div.hg-facts',
    h('span.hg-beauty', svgIcon('flower', 18), t('market.facts.beauty', { b: fmt(p.beauty) })),
    h('span', t('market.facts.tiles', { w: p.size[0], h: p.size[1] })),
    p.hours && !locked ? h('span', { title: t('home.grand.hoursTip') }, t('home.grand.hours', { h: p.hours })) : null);
  const foot = h('div.pn-card-foot');
  if (locked) foot.append(h('span.pn-later', p.live ? t('market.why.unlockAt', { n: p.unlock }) : t('home.grand.later')));
  else {
    foot.append(p.tray ? h('span.pn-cost.pn-free', t('market.kit.free')) : price(p.price, { big: p.big }),
      kit.button({ label: p.tray ? t('market.card.place') : t('home.grand.buyPlace'), glyph: 'hammer', cls: 'btn--sun', data: { place: p.id },
        gate: () => {
          const f = grandView(ctx.store.state, { now: ctx.now(), pid: ctx.store.pid }).pieces.find((x) => x.id === p.id);
          return f && f.code ? { code: f.code, hint: f.hint } : null;
        },
        onClick: () => startPlacement(ctx, p.id) }));
  }
  // the content text says what a piece does; a seat that it does not mention gets its own words
  const extra = [p.text, /seat/i.test(p.textEn || p.text || '') ? null : SEAT(p.effect)].filter(Boolean);
  return h(`article.hg-card${locked ? '.locked' : ''}${p.owned ? '.owned' : ''}`, { role: 'listitem', dataset: { def: p.id } },
    art, h('h4.hg-name', p.name), facts,
    extra.length ? h('p.hg-text', extra.join('. ')) : null,
    previewLine(p, v), foot);
}

export const grandDecorPanel = {
  title: () => phoneTitle('home.grand.title', 'home.grand.titleShort'),
  icon: 'grand_windmill',
  size: 'full',
  topics: ['wallet', 'objects', 'xp', 'storage', 'wishlist', 'beauty'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const env = () => ({ now: ctx.now(), pid: ctx.store.pid });
    const sig = () => {
      const v = grandView(ctx.store.state, env());
      return [v.level, v.beauty, v.pieces.map((p) => [p.id, p.code, p.owned, p.tray, p.big, p.after && p.after.score]),
        Object.keys(ctx.store.state.farm.wishlist ?? {}).length];
    };
    const update = kit.memo(body, sig, render);
    function render() {
      const v = grandView(ctx.store.state, env());
      const head = h('div.hg-head',
        h('div.hg-head-text', h('h3', t('home.grand.head')),
          h('p', t('home.grand.intro'))),
        v.beauty ? h('div.hg-meter', { title: t('home.grand.meterTip') }, svgIcon('flower', 30),
          h('div', h('b', fmt(v.beauty.score)), h('small', `${'★'.repeat(v.beauty.stars)}${'☆'.repeat(5 - v.beauty.stars)}`)),
          ctx.ui.panels.has('beauty') ? h('button.pn-chipbtn', { type: 'button', on: { click: () => ctx.open('beauty', {}, { stack: true }) } }, t('home.grand.beautyBtn')) : null) : null);
      fill(body, head,
        v.live ? null : h('p.hg-soon', svgIcon('lock', 20), t('home.grand.arrives')),
        h('div.hg-grid', { role: 'list', 'aria-label': t('home.grand.title') }, ...v.pieces.map((p) => pieceCard(ctx, kit, p, v))));
      kit.refresh();
      const want = ctx.args && ctx.args.focus;
      if (want && ctx.focusDone !== want) {
        ctx.focusDone = want;
        requestAnimationFrame(() => body.querySelector(`[data-def="${CSS.escape(String(want))}"]`)?.scrollIntoView({ block: 'center' }));
      }
    }
    update(true);
    return { update: () => { update(); kit.refresh(); } };
  },
};

/**
 * A strip for the Market's Decor tab: three Grand pieces and "Open the showroom" (null before the Grand decor is
 * live or before its first level). ui-panels adds it to the Decor tab head (note in docs/agent-notes/w3-ui-home.md).
 */
export function grandStrip(ctx) {
  const v = grandView(ctx.store.state, { now: ctx.now(), pid: ctx.store.pid });
  if (!v.live || v.first === null || v.level < v.first) return null;
  // the newest open pieces and the next one to come: what the couple can buy and what they save toward
  const liveP = v.pieces.filter((p) => p.live);
  const nextI = liveP.findIndex((p) => p.unlock > v.level);
  const end = nextI < 0 ? liveP.length : nextI + 1;
  const show = liveP.slice(Math.max(0, end - 3), end);
  return h('div.hg-strip', { dataset: { grand: 'strip' } },
    h('div.hg-strip-icons', ...show.map((p) => icon(p.id, { size: 44, alt: '' }))),
    h('div.hg-strip-text', h('b', t('home.grand.title')), h('small', t('home.grand.strip', { open: v.open, owned: v.owned }))),
    h('button.btn.btn--sky.pn-sm', { type: 'button', dataset: { open: 'grandDecor' }, on: { click: () => ctx.open('grandDecor') } },
      t('home.grand.showroom')));
}

