// The gift sheet (release 1.0, D1 Surprise gifts; features#F1, astra#A; trimmed by critique#29): wrap one thing from
// the Barn for your partner, once a day. It waits in front of the farmhouse porch until they open it (rules:
// shared/rules/actions/coop.js keepsake / openGift / _gift). Flowers first (Rose, Lavender, Sunflower), then the eight
// goods the Barn holds most of; three one-tap notes (a phone never has to type) plus an optional line; one Send. The
// giver's own box says "For {name}: waiting"; a box waiting for ME can be opened from here too (the box on the farm is
// the main door). Features lane; registered lazily by ui-panels (`ui.panels.register('gift', …)` imports this file on
// the first open: scope §8 "the gift panel lazy"); opened with `ui.panels.open('gift')` (ui-shell's Together entry).
// Built from the shared components (docs/agent-briefs/rel-components.md): tiles `button.pn-stack`, notes
// `div.chips > button.chip`, the field `input.field`, one primary `button.btn`, the secondary `btn btn--paper`.
//
//   giftPanel                      the panel spec (title, size, topics, mount)
//   openGiftSheet(ui)              ui.panels.open('gift')
//   giftChoices(state, pid) -> [{ id, n, flower }]   what the grid offers, in order (pure; tests)
//   giftStatus(state, pid, now) -> { code, partner?, mine?, forMe? }                  (pure; tests)
import { COOP, itemOf, isLive } from '../../../../shared/content/index.js';
import { available } from '../../../../shared/rules/economy.js';
import { othersOf, capUsed, dayOf } from '../../../../shared/rules/coop.js';
import { giftsFor, waitingBoxOf } from '../../../../shared/rules/actions/coop.js';
import { h, icon, svgIcon, fmt, createKit, empty, section } from './kit.js';
import { ensureStylesheet, touchPlayer } from '../dom.js';
import { assetUrl } from '../../net/asset-base.js';
import { t, name as cname } from '../../i18n/index.js';

const MORE = 8;
/** The camera's ease to the box before it opens (the sheet's Open it: QA r1 L-01). */
const OPEN_PAN_MS = 600;
/**
 * The three one-tap notes, by catalog key. QA r2 F2-02: one is sent as its token ("#thanks", content COOP.keepsake.chips),
 * never as the words the giver saw, so each screen says it in its own language (ui/goal-text.js noteText).
 */
export const NOTE_KEYS = Object.freeze((COOP.keepsake.chips ?? []).map((id) => `feat.gift.note.${id}`));
/** The note a chip sends: its token. */
export const chipNote = (key) => `#${String(key).slice('feat.gift.note.'.length)}`;

/** The partner a gift goes to: the only other farmer (two-player farms), else null. */
const partnerOf = (state, pid) => {
  const o = othersOf(state, pid);
  return o.length === 1 ? o[0] : null;
};

/** What the grid offers: the flowers the Barn holds (in content order), then the 8 most plentiful other goods. Pure. */
export function giftChoices(state, pid) {
  void pid;
  const flowers = COOP.keepsake.flowers ?? [];
  const ok = (id) => {
    const it = itemOf(id);
    return Boolean(it && it.giftable && isLive(it));
  };
  const out = [];
  for (const id of flowers) {
    const n = ok(id) ? available(state, id) : 0;
    if (n > 0) out.push({ id, n, flower: true });
  }
  const rest = Object.keys(state.farm.inventory ?? {}).filter((id) => !flowers.includes(id) && ok(id))
    .map((id) => ({ id, n: available(state, id), flower: false })).filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || (a.id < b.id ? -1 : 1));
  return out.concat(rest.slice(0, MORE));
}

/**
 * Where this farmer stands with gifts now. Pure. code: 'solo' (no partner) | 'waiting' (my box waits on the porch and
 * I wrapped today) | 'again' (my box from an earlier day still waits, and today's wrap is free: a new one sends the
 * waiting one to the partner's shelf, as the rules do) | 'today' (wrapped one today) | 'ready'; forMe = the boxes
 * waiting for me to open ([[id, gift]]). QA r3 F3-03 (fe#3): 'waiting' outranked a free day and the sheet offered no
 * Wrap and no reason, though the card says "once a day".
 */
export function giftStatus(state, pid, now) {
  const partner = partnerOf(state, pid);
  const forMe = giftsFor(state, pid);
  if (!partner) return { code: 'solo', forMe };
  const mine = waitingBoxOf(state, pid);
  const wrappedToday = capUsed(state, pid, 'keepsake', dayOf(state, now)) >= COOP.keepsake.perDay;
  if (mine) return { code: wrappedToday ? 'waiting' : 'again', partner, mine, forMe };
  if (wrappedToday) return { code: 'today', partner, forMe };
  return { code: 'ready', partner, forMe };
}

/** How long the sheet waits for life-feel's reveal card after "Open it" before giving up on moving the focus to it. */
const REVEAL_FOCUS_MS = 3000;
/**
 * QA r3 S3-C1 (ui-shell's patch; ap#1): after "Open it" the sheet closes under the keyboard focus; the reveal card
 * (life-feel's banner `[data-id="gift-open-<id>"]`, a moment later) takes it, on its "♥ Thanks" (else its first button),
 * unless the player has put the focus somewhere since.
 */
export function focusReveal(id, waitMs = REVEAL_FOCUS_MS) {
  const doc = globalThis.document;
  if (!doc) return;
  // where the closing sheet left the focus (its opener, or <body>): still there when the card comes = nobody moved it
  const left = doc.activeElement;
  let waited = 0;
  const tryNow = () => {
    const card = doc.querySelector(`[data-id="gift-open-${id}"]`);
    const btn = card ? [...card.querySelectorAll('button')].find((b) => !b.hidden && !b.classList.contains('x')) : null;
    const now = doc.activeElement;
    const untouched = !now || now === doc.body || now === left;
    if (btn) { if (untouched) btn.focus({ preventScroll: true }); return; }
    waited += 150;
    if (waited < waitMs) setTimeout(tryNow, 150);
  };
  setTimeout(tryNow, 150);
}

/** Open the sheet (the Together entry, the gift drip card's Show me). */
export function openGiftSheet(ui) {
  return ui?.panels?.open ? ui.panels.open('gift') : false;
}

export const giftPanel = {
  get title() { return t('feat.gift.title'); },
  icon: null,
  size: 'side',
  topics: ['inventory', 'objects', 'players'],
  mount(body, ctx) {
    ensureStylesheet(assetUrl('/css/panels-rel.css'));
    const kit = createKit(ctx);
    let pick = null;
    let note = null;           // a chip's key, or null
    let typed = '';
    const pid = ctx.store.pid;
    const nameOf = (p) => ctx.store.state.players[p]?.name ?? t('feat.gift.partner');
    const focusBox = (id) => {
      const o = ctx.store.state.farm.objects[id];
      if (o && typeof ctx.view?.focus === 'function') { ctx.view.focus(o.x, o.z); ctx.close(); }
    };
    /** Open a box waiting for me where it can be seen: pan to it, close the sheet, open it once the camera is there. */
    const openInView = (id) => {
      const o = ctx.store.state.farm.objects[id];
      if (!o || typeof ctx.view?.focus !== 'function') { ctx.act('openGift', { id }); focusReveal(id); return; }
      ctx.view.focus(o.x + 0.5, o.z + 0.5);
      ctx.close();
      setTimeout(() => { ctx.act('openGift', { id }); focusReveal(id); }, OPEN_PAN_MS);
    };

    const top = h('div.rel-gift-top');
    // QA r3 S3-23 (ui-shell's patch; ap#5): a listbox moves on the arrow keys, Home and End, and is one Tab stop (a roving
    // tabindex: the focused, else the picked, else the first tile), like the Tools ▸ group and the Together menu
    const grid = h('div.pn-stacks.rel-gift-grid', { role: 'listbox', 'aria-label': t('feat.gift.pick'), on: { keydown: (e) => {
      const tiles = [...grid.querySelectorAll('.pn-stack')];
      if (!tiles.length) return;
      const i = tiles.indexOf(globalThis.document?.activeElement);
      const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: tiles.length - 1 }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      const next = tiles[Math.max(0, Math.min(tiles.length - 1, i < 0 ? 0 : to))];
      rove(next);
      next.focus({ preventScroll: false });
    } } });
    /** The grid's one Tab stop is `tile`. */
    const rove = (tile) => { for (const b of grid.querySelectorAll('.pn-stack')) b.setAttribute('tabindex', b === tile ? '0' : '-1'); };
    const chips = h('div.chips.rel-gift-notes', { role: 'group', 'aria-label': t('feat.gift.noteLabel') });
    // QA r2 F2-01: the field names its button (ui-shell's keepInView keeps both above a phone's keyboard)
    const field = h('input.field.rel-gift-field', { type: 'text', maxlength: String(COOP.keepsake.noteMax),
      placeholder: t('feat.gift.own'), 'aria-label': t('feat.gift.own'), dataset: { keepInView: 'gift-send' },
      on: { input: (e) => { typed = e.target.value; if (typed.trim()) note = null; drawChips(); kit.refresh(); } } });
    const words = () => (typed.trim() ? typed.trim() : note ? chipNote(note) : null);
    const send = kit.button({
      label: () => t('feat.gift.send', { name: nameOf(partnerOf(ctx.store.state, pid)) }), glyph: 'heart',
      cls: 'rel-gift-send', key: 'gift-send', data: { gift: 'send', act: 'gift-send' },
      type: 'keepsake',
      args: () => ({ item: pick ?? '', ...(words() ? { note: words().slice(0, COOP.keepsake.noteMax) } : {}) }),
      gate: () => (pick ? null : { code: 'EMPTY', hint: { text: t('feat.gift.pickFirst') } }),
      after: (r) => {
        if (!r || r.ok === false) return;           // a refusal (or Keep N's "are you sure?") keeps the sheet as it was
        const item = pick;
        pick = null; note = null; typed = ''; field.value = '';
        // QA r1 F-08: the sheet's job is done: it closes (a tall sheet with one line and blank paper said nothing),
        // and a line says where the surprise waits
        ctx.ui?.toast?.(t('feat.gift.sent', { name: nameOf(partnerOf(ctx.store.state, pid)) }), { kind: 'info', icon: item });
        ctx.close();
      },
    });
    const form = h('div.rel-gift-form', section(t('feat.gift.pick'), grid),
      section(t('feat.gift.noteLabel'), chips, field), h('div.rel-gift-foot', send));
    body.append(top, form);

    // QA r2 F2-10 (ap#1): a pick changes the chips and tiles in place: a redraw replaced the pressed button and the
    // keyboard focus fell to <body>
    function drawChips() {
      if (!chips.children.length) {
        chips.append(...NOTE_KEYS.map((k) => h('button.chip', { type: 'button', 'aria-pressed': 'false',
          dataset: { note: k }, on: { click: () => { note = note === k ? null : k; typed = ''; field.value = ''; drawChips(); kit.refresh(); } } },
        t(k))));
      }
      for (const b of chips.children) b.setAttribute('aria-pressed', String(b.dataset.note === note));
    }

    // each part is redrawn only when what it shows changed: a re-render on every store change would replace the button
    // under a finger or the keyboard focus (topics fire on any inventory move)
    let gridSig = '';
    let topSig = '';
    const markPick = () => {
      for (const b of grid.querySelectorAll('.pn-stack')) {
        const on = b.dataset.item === pick;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', String(on));
      }
    };
    function drawGrid() {
      const list = giftChoices(ctx.store.state, pid);
      if (pick && !list.some((x) => x.id === pick)) pick = null;
      // the tiles are rebuilt only when what the Barn offers changed; a pick only marks them (F2-10)
      const sig = JSON.stringify(list.map((x) => [x.id, x.n]));
      if (sig !== gridSig) {
        gridSig = sig;
        const had = globalThis.document?.activeElement;
        const focused = had && grid.contains(had) ? had.dataset?.item : null;
        grid.replaceChildren();
        if (!list.length) grid.append(empty(t('feat.gift.nothing'), 'heart'));
        for (const x of list) {
          const label = cname(x.id, { family: 'items' });
          const tile = h('button.pn-stack', {
            type: 'button', role: 'option', 'aria-selected': 'false', tabindex: '-1', dataset: { item: x.id, key: `gift-${x.id}` },
            title: t('feat.gift.tile', { item: label, n: x.n }),
            on: { click: () => { pick = x.id; drawGrid(); kit.refresh(); }, focus: () => rove(tile) },
          }, icon(x.id, { size: 48, alt: '' }), h('span.pn-stack-n', `×${fmt(x.n)}`), h('span.pn-stack-name', label),
          x.flower ? h('span.rel-gift-flower', { 'aria-hidden': 'true' }, '✿') : null);
          grid.append(tile);
        }
        const tiles = [...grid.querySelectorAll('.pn-stack')];
        rove(tiles.find((b) => b.dataset.item === focused) ?? tiles.find((b) => b.dataset.item === pick) ?? tiles[0] ?? null);
        // a store change under the keyboard focus (the partner sold some Wool) puts it back on the same good
        if (focused) tiles.find((b) => b.dataset.item === focused)?.focus({ preventScroll: true });
      }
      markPick();
    }

    function drawTop() {
      const st = ctx.store.state;
      const s = giftStatus(st, pid, ctx.now());
      const sig = JSON.stringify([s.code, s.mine ?? null, s.forMe.map(([id]) => id), s.partner ? nameOf(s.partner) : null]);
      form.hidden = s.code !== 'ready' && s.code !== 'again';
      if (sig === topSig) return;
      topSig = sig;
      top.replaceChildren();
      for (const [id, g] of s.forMe) {
        top.append(h('div.rel-gift-card.for-me', { dataset: { giftFor: id } }, svgIcon('heart', 36),
          h('p', t('feat.gift.forMe', { name: nameOf(g.by) })),
          h('div.rel-gift-acts',
            kit.button({ label: t('feat.gift.open'), glyph: 'heart', key: `open-${id}`, type: 'openGift', args: { id },
              data: { gift: 'unwrap' },
              // QA r1 L-01: the opening plays in view: the sheet closes, the farm pans to the box, then it opens (the
              // reveal card with the note is life-feel's, either door)
              onClick: () => openInView(id) }),
            typeof ctx.view?.focus === 'function' ? h('button.btn.btn--paper.btn--small', { type: 'button',
              on: { click: () => focusBox(id) } }, t('feat.gift.show')) : null)));
      }
      if (s.code === 'solo') top.append(empty(t('feat.gift.solo'), 'heart'));
      else if (s.code === 'waiting' || s.code === 'again') {
        const g = st.farm.gifts?.[s.mine];
        top.append(h('div.rel-gift-card.mine', { dataset: { giftMine: s.mine } }, g ? icon(g.item, { size: 40, alt: '' }) : svgIcon('heart', 36),
          h('p', t('feat.gift.waiting', { name: nameOf(s.partner) }),
            // QA r1 F-08: what you wrapped, and whether a note went with it
            g ? h('small.rel-gift-what', t(g.note ? 'feat.gift.whatNote' : 'feat.gift.what', { item: cname(g.item, { family: 'items' }) })) : null),
          typeof ctx.view?.focus === 'function' ? h('div.rel-gift-acts', h('button.btn.btn--paper.btn--small', { type: 'button',
            on: { click: () => focusBox(s.mine) } }, t('feat.gift.show'))) : null));
        // QA r3 F3-03 (fe#3): why there is no Wrap today, or what a new wrap does to the box still waiting (the rules
        // send it to the partner's shelf: nothing lost)
        top.append(s.code === 'waiting'
          ? h('p.rel-gift-note', { dataset: { gift: 'today' } }, t('feat.gift.today', { name: nameOf(s.partner) }))
          : h('p.rel-gift-note', { dataset: { gift: 'again' } }, g
            ? t('feat.gift.again', { item: cname(g.item, { family: 'items' }), name: nameOf(s.partner) })
            : t('feat.gift.againAny', { name: nameOf(s.partner) })));
      } else if (s.code === 'today') top.append(h('p.rel-gift-note', t('feat.gift.today', { name: nameOf(s.partner) })));
      else top.append(h('p.rel-gift-note', t(touchPlayer() ? 'feat.gift.leadTouch' : 'feat.gift.lead', { name: nameOf(s.partner) })));
    }

    const draw = () => { drawTop(); drawGrid(); drawChips(); kit.refresh(); };
    draw();
    return { update: () => draw() };
  },
};
