// An animal home (GDD §3.4): every animal with what it needs right now (baby + bottle, hungry, producing with a
// timer, ready to collect), its blue-ribbon progress and today's petting, "Tend all" / "Pet all" for the whole home,
// the capacity upgrade and buying more. Opened with args { id } = a home or one of its animals; args.focus 'room'
// scrolls to the room step.
import { itemOf, MASTERY, COOP, BOOSTS } from '../../../../shared/content/index.js';
import { h, icon, fmt, fmtDuration, createKit, bar, chip, empty, pill, ribbonTag, stars, price } from './kit.js';
import { homeView, levelOf, starsOf, priceOf, durationText, placedOf, hurryQuote, blockerText } from './model.js';
import { I } from './intents.js';
import { rosette } from './art.js';
import { m1bSection } from './animals-m1b.js';
import { homeGrowth, growthTiles, buyQuote } from './w4b-rules.js';
import { t, N, Q, list, getters, name as cname } from '../../i18n/index.js';

const lazy = (f) => ({ type: () => f().type, args: () => f().args });

const STATUS = getters({
  baby: () => t('farm.ani.status.baby'),
  hungry: () => t('farm.ani.status.hungry'),
  producing: () => t('farm.ani.status.producing'),
  ready: () => t('farm.ani.status.ready'),
});
/** A product's name, or the word "product" (lower case inside a line). */
const prodName = (id) => (itemOf(id) ? cname(id) : t('farm.ani.product'));

export const animalsPanel = {
  title: (args, state) => (state ? homeView(state, args.id, 0)?.name ?? t('farm.ani.title') : t('farm.ani.title')),
  size: 'wide',
  topics: ['objects', 'inventory', 'wallet', 'xp', 'mastery', 'keep'],
  mount(body, ctx) {
    const kit = createKit(ctx);
    const view = () => homeView(ctx.store.state, ctx.args.id, ctx.now());
    const sig = () => {
      const v = view();
      const g = v && homeGrowth(ctx.store.state, v.id);
      return v && [v.cap, v.animals.map((a) => [a.id, a.status, a.end, a.cycle, a.petBy, a.name, a.refundable]), v.feeds, levelOf(ctx.store.state),
        g && [g.code, g.next, g.coins, g.grows, g.blockers]];
    };
    const update = kit.memo(body, sig, render);

    function render() {
      body.replaceChildren();
      const v = view();
      if (!v) { body.append(empty(t('farm.ani.gone'), 'barn')); return; }
      ctx.setTitle(v.name);
      const st = ctx.store.state;
      const sp = v.species[0];
      const mastery = sp ? starsOf(st, 'animals', sp.id) : null;
      const prize = prizeLine(v);
      body.append(
        h('div.pn-bhead',
          h('div.pn-bhead-art', icon(v.def.id, { size: 72 })),
          h('div.pn-bhead-text',
            h('p.pn-bhead-status', sp ? t('farm.ani.count', { have: v.animals.length, n: v.cap, what: plural(sp.name, v.cap), sp: N(sp.id) })
              : t('farm.ani.countAny', { n: v.animals.length, cap: v.cap }),
              v.ready ? pill(t('farm.ani.nReady', { n: v.ready }), 'pn-owned') : null, v.hungry ? pill(t('farm.ani.nHungry', { n: v.hungry }), 'pn-warn') : null),
            h('div.pn-feedline', ...v.feeds.map((f) => h('span.pn-feed', chip(f.item, { n: f.have, size: 28, tab: true }),
              h('span', f.keep ? t('farm.ani.feedKeep', { item: cname(f.item), n: f.keep }) : t('farm.ani.feedIn', { item: cname(f.item) })))),
            mastery && levelOf(st) >= MASTERY.unlock ? h('span.pn-mast', { title: mastery.next ? t('farm.ani.masteryNext', { s: mastery.stars + 1, n: mastery.next }) : t('farm.tree.topMastery') },
              stars(mastery.stars), t('farm.ani.collected', { n: mastery.count })) : null,
            // one blue-ribbon line for the whole home, not "0/60 to a blue ribbon" under every animal (UI-37)
            prize ? h('div.pn-ani-prize.pn-home-prize', { title: t('farm.ani.prizeTip', { n: prize.at }) },
              rosette(prize.next ? 1 : 2, 18), prize.next ? bar(prize.next.cycle / prize.at, null, 'pn-thin pn-ribbonbar') : null, h('small', prize.text)) : null)),
          h('div.pn-bhead-acts',
            kit.button({ label: t('farm.ani.tendAll'), glyph: 'check', cls: 'btn--sun', ...lazy(() => I.tend(v.id)), data: { tend: v.id },
              hint: () => {
                const cur = view();
                const left = cur && Number.isFinite(cur.nextAt) ? cur.nextAt - ctx.now() : null;
                const what = itemOf(sp?.product)?.name?.toLowerCase() ?? 'product'; // i18n-ok: English word (Bulgarian: prod)
                return { missing: v.feeds.filter((f) => f.have === 0).map((f) => ({ item: f.item, n: 1 })),
                  texts: { NOT_READY: left !== null ? t('farm.ani.allTended', { what, prod: prodName(sp?.product), d: fmtDuration(left) }) : t('market.relic.noneToTend') } };
              } }),
            sp && sp.feed === null ? null : kit.button({ label: t('farm.ani.petAll'), glyph: 'hand', cls: 'pn-sm btn--sky', ...lazy(() => I.pet(v.id)), data: { pet: v.id },
              hint: { done: t('farm.ani.allPetted') } }))),
        animalGrid(v),
        // the M1b species' own section: truffles, the pond, the goat, the horse (Ride), the hive's forage (ui-collect)
        ...[m1bSection(v, ctx)].filter(Boolean),
        footer(v));
      kit.refresh();
      kit.tick();
    }

    function animalGrid(v) {
      const grid = h('div.pn-animals', { role: 'list' });
      if (!v.animals.length) {
        grid.append(empty(v.species[0] ? t('farm.ani.none', { what: plural(v.species[0].name, 2).toLowerCase(), sp: N(v.species[0].id) })
          : t('farm.ani.noneAny'), 'heart'));
      }
      const st = ctx.store.state;
      for (const a of v.animals) {
        const fill = bar(0, null, a.status === 'baby' ? 'pn-thin pn-go' : 'pn-thin pn-sky');
        const line = h('span.pn-ani-state');
        if (a.status === 'baby' || a.status === 'producing') {
          kit.timer(line, { end: a.end, start: a.start, bar: fill, prefix: a.status === 'baby' ? t('farm.ani.grownIn') : t('farm.ani.productIn', { prod: prodName(a.def.product) }), done: () => update(true) });
        } else {
          // one reason per hungry animal: the line says what it wants AND whether the barn has it; the Feed button
          // then stays quiet about NO_ITEMS (it used to repeat "Need 1 more Chicken Feed" under "Wants 1 Chicken Feed")
          const feedName = itemOf(a.feed) ? cname(a.feed) : t('farm.ani.feed');
          const haveFeed = (v.feeds.find((f) => f.item === a.feed)?.have ?? 0) >= a.feedQty;
          const wants = { n: a.feedQty, feed: feedName, q: itemOf(a.feed) ? Q(a.feed, a.feedQty) : `${feedName} ×${a.feedQty}` };
          line.textContent = a.status === 'ready' ? t('farm.ani.waiting', { prod: itemOf(a.def.product) ? cname(a.def.product) : t('farm.ani.productCap') })
            : haveFeed ? t('farm.ani.wants', wants) : t('farm.ani.wantsNone', wants);
        }
        // a Beehive's colony is never petted (GDD §3.4 Bees)
        const hearts = a.def.feed === null ? null : h('span.pn-ani-pet', { title: a.petBy.length ? t('farm.ani.pettedBy', { who: list(a.petBy.map((p) => st.players[p]?.name ?? p)) }) : t('farm.ani.notPetted') },
          ...(a.petBy.length ? a.petBy.map((p) => h('span.pn-heart', { style: { '--who': st.players[p]?.color ?? '#E8556E' } }, '♥')) : [h('span.pn-heart.off', '♡')]));
        const q = (a.status === 'baby' || a.status === 'producing') && levelOf(st) >= BOOSTS.hurry.unlock ? hurryQuote(st, a.id, ctx.now()) : null;
        const hurry = q ? kit.button({ label: `${q.acorns}`, glyph: 'acorn', cls: 'pn-xs btn--sun pn-hurry', title: a.baby ? t('farm.ani.hurryBaby') : t('farm.ani.hurryReady'),
          ...lazy(() => I.hurry(a.id)), data: { hurry: a.id },
          hint: () => ({ acorns: Math.max(0, (hurryQuote(ctx.store.state, a.id, ctx.now())?.acorns ?? 0) - ctx.store.state.farm.wallet.acorns) }) }) : null;
        const act = a.status === 'baby'
          ? kit.button({ label: t('farm.ani.bottle'), icon: a.bottle, cls: 'pn-xs btn--sky', ...lazy(() => I.bottle(a.id)), data: { bottle: a.id },
            title: t('farm.ani.bottleTip', { item: cname(a.bottle) }), hint: () => ({ missing: [{ item: a.bottle, n: 1 }] }) })
          : a.status === 'producing' ? null
            : kit.button({ label: a.status === 'ready' ? t('farm.ani.collect') : t('farm.ani.feedBtn'), cls: 'pn-xs', ...lazy(() => I.tend(a.id)), data: { tend: a.id },
              hint: () => ({ missing: [{ item: a.feed, n: a.feedQty }] }), quiet: a.status === 'hungry' ? ['NO_ITEMS'] : null });
        const prize = a.prized ? ribbonTag(t('farm.ani.blueRibbon'), 'pn-try') : null;
        // a chick is yellow whatever hen it grows into: its backdrop is a soft straw yellow
        const tint = a.baby ? (BABY_ICONS[a.def.id] ? '#F6DE7A' : null) : animalTint(a.id, a.def.id);
        grid.append(h(`article.pn-ani.${a.status}`, { role: 'listitem', dataset: { animal: a.id } },
          h('div.pn-ani-art', { style: tint ? { '--tint': tint } : null, dataset: { tint: tint ? 'on' : 'off' } },
            icon(a.baby ? babyIcon(a.def.id) : a.def.id, { size: a.baby ? 50 : 60 }), a.baby ? h('span.pn-ani-baby', t('farm.ani.babyTag')) : null),
          h('div.pn-ani-main',
            h('div.pn-ani-top', nameTag(a), h('span.pn-ani-status', STATUS[a.status]), hearts),
            line, a.status === 'baby' || a.status === 'producing' ? fill : null, prize),
          h('div.pn-ani-acts', act, hurry, sellBtn(a))));
      }
      return grid;
    }

    /** The animal's name: click to name it (shared; the tag records who named it, GDD §6.1). */
    function nameTag(a) {
      const st = ctx.store.state;
      const shown = a.name || cname(a.def.id);
      const btn = h('button.pn-name', { type: 'button', dataset: { key: `name-${a.id}` },
        title: a.name ? t('farm.ani.namedBy', { name: st.players[a.namedBy]?.name ?? t('farm.ani.youTwo') })
          : t('farm.ani.giveName', { what: a.def.name.toLowerCase(), sp: N(a.def.id) }),
        on: { click: () => {
          const input = h('input.pn-input.pn-name-input', { maxlength: '16', value: a.name || '', placeholder: t('farm.ani.namePh'),
            'aria-label': t('farm.ani.nameFor', { what: a.def.name, sp: N(a.def.id) }) });
          let finished = false;
          const done = (save) => {
            if (finished) return;
            finished = true;
            const v = input.value.trim();
            if (save && v && v !== a.name) { const it = I.nameAnimal(a.id, v); ctx.act(it.type, it.args); }
            input.replaceWith(btn);
          };
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') { e.stopPropagation(); done(false); } });
          input.addEventListener('blur', () => done(true));
          btn.replaceWith(input);
          input.focus();
        } } }, h('b', shown), h('span.pn-pencil', { 'aria-hidden': 'true' }, '✎'));
      return btn;
    }

    function sellBtn(a) {
      if (a.def.feed === null) return null;           // a Beehive's colony leaves only with its hive (GDD §3.4)
      if (a.refundable) {
        return kit.confirmButton({ label: t('farm.ani.undoBuy'), cls: 'pn-xs pn-ghost', confirm: t('farm.ani.refund', { n: a.paid }), ...lazy(() => I.refund(a.id)) });
      }
      const back = a.free ? 0 : Math.floor((a.paid * (a.prized ? 10_000 : 5000)) / 10_000);
      return kit.confirmButton({ label: t('farm.ani.sell'), cls: 'pn-xs pn-ghost', confirm: back ? t('farm.ani.sellFor', { n: back }) : t('farm.ani.letGo'), ...lazy(() => I.sellObject(a.id)) });
    }

    function footer(v) {
      const st = ctx.store.state;
      const out = h('div.pn-anifoot');
      out.append(roomRow(v));
      for (const sp of v.species) {
        if (levelOf(st) < sp.unlock || sp.shop === false) continue;   // a colony comes with its Beehive
        const baby = priceOf(st, sp.id, { adult: false });
        const adult = priceOf(st, sp.id, { adult: true });
        out.append(h('div.pn-buyani',
          h('div.pn-upgrade-text', h('b', t('farm.ani.another', { what: sp.name.toLowerCase(), sp: N(sp.id) })),
            h('span', t('farm.ani.onFarm', { n: placedOf(st, sp.id).length, d: durationText(sp.babyMs) }))),
          buyRow(v, sp, false, baby), buyRow(v, sp, true, adult),
          // a full home makes room for the next one itself (wave 4b): its room step is in the price
          v.room === 0 && quoteOf(v, sp, false)?.step > 0 ? h('small.pn-buyani-note', quoteOf(v, sp, false).grows
            ? t('farm.ani.includesGrow', { n: quoteOf(v, sp, false).step, home: N(v.def.id) }) : t('farm.ani.includes', { n: quoteOf(v, sp, false).step })) : null));
      }
      if (v.species[0]?.feed !== null) {
        out.append(h('p.pn-hint', t('farm.ani.petHint', { what: v.species[0] ? itemOf(v.species[0].product)?.name.toLowerCase() : 'product', // i18n-ok: English word (Bulgarian: prod)
          prod: v.species[0] ? prodName(v.species[0].product) : t('farm.ani.product'), b: COOP.petting.bothBp / 100 })));
      }
      return out;
    }

    const quoteOf = (v, sp, adult) => buyQuote(ctx.store.state, sp.id, adult, v.id);
    /** One "Baby / Adult · price · Buy" row; its price includes the room step when the home has to grow for it. */
    function buyRow(v, sp, adult, base) {
      const q = quoteOf(v, sp, adult);
      const coins = () => buyQuote(ctx.store.state, sp.id, adult, v.id)?.coins ?? priceOf(ctx.store.state, sp.id, { adult }).coins;
      const g = homeGrowth(ctx.store.state, v.id);
      return h('div.pn-buyani-row', h('span', adult ? t('farm.ani.adultShort') : t('market.animal.baby')), price(q && q.code === null ? { coins: q.coins } : base),
        kit.button({ label: t('market.card.buy'), cls: 'pn-xs', ...lazy(() => I.buyAnimal(sp.id, adult, v.id)), data: { buy: sp.id, adult: String(adult) },
          hint: () => ({ coins: Math.max(0, coins() - ctx.store.state.farm.wallet.coins), cap: g?.max ?? v.cap,
            texts: { BLOCKED: t('farm.ani.noRoom', { why: blockText(g) }), OUT_OF_BOUNDS: t('farm.ani.noRoomEdge', { home: N(v.def.id) }) } }) }));
    }

    /** "the Bench and an Apple Tree are in the way" (model.blockerText: the Market's card says it the same way) */
    const blockText = (g) => blockerText(ctx.store.state, g ? g.blockers : []);

    /**
     * Room in the home (wave 4b, owner wish 3): what the next step gives and costs, the bigger footprint it needs (Show
     * where: the new tiles light up on the farm), and when something is in the way, what it is, with Move the home.
     */
    function roomRow(v) {
      const st = ctx.store.state;
      const g = homeGrowth(st, v.id);
      const sz = (s) => (Array.isArray(s) ? `${s[0]}×${s[1]}` : '');
      if (!g || g.code === 'CAP' || g.code === 'NOT_FOUND') {
        return h('div.pn-upgrade', h('div.pn-upgrade-text', h('b', t('farm.ani.roomiest')), h('span', t('farm.ani.mostHolds', { n: g?.max ?? v.max }))));
      }
      const blocked = g.code === 'BLOCKED' || g.code === 'OUT_OF_BOUNDS';
      const row = h(`div.pn-upgrade.pn-room${blocked ? '.blocked' : ''}`, { dataset: { room: v.id } },
        h('div.pn-upgrade-text', h('b', t('farm.ani.makeRoom', { cap: g.cap, next: g.next })),
          h('span', g.grows ? t('farm.ani.growsTo', { home: N(v.def.id), sz: sz(g.nextSize), max: g.max }) : t('farm.ani.roomFor', { max: g.max }))),
        price({ coins: g.coins }),
        kit.button({ label: t('market.barn.upgradeBtn'), glyph: 'hammer', cls: 'pn-sm', ...lazy(() => I.upgradeHome(v.id)), data: { upgradehome: v.id },
          quiet: ['BLOCKED', 'OUT_OF_BOUNDS'], hint: () => ({ coins: Math.max(0, g.coins - ctx.store.state.farm.wallet.coins) }) }));
      if (!g.grows) return row;
      const acts = h('div.pn-room-acts',
        h('button.pn-chipbtn', { type: 'button', dataset: { showgrow: v.id }, on: { click: () => showGrowth(v, g) } }, blocked ? t('farm.crate.show') : t('farm.ani.showWhere')),
        blocked && ctx.controller?.move ? h('button.pn-chipbtn.pn-room-move', { type: 'button', dataset: { movehome: v.id },
          on: { click: () => { ctx.close(); ctx.controller.move(v.id); } } }, t('farm.ani.moveHome', { home: N(v.def.id) })) : null);
      const why = blocked ? h('p.pn-room-why', { role: 'note' }, t('farm.ani.roomWhy', { n: g.blockers.length, sz: sz(g.nextSize), home: N(v.def.id), why: blockText(g) })) : null;
      return h('div.pn-room-wrap', row, why, acts);
    }

    /** Light up the tiles the next step adds (green) and the ones in the way (red) for a few seconds; camera on it. */
    function showGrowth(v, g) {
      const view = ctx.view;
      if (!view) return;
      const { add, blocked } = growthTiles(ctx.store.state, v.id, g);
      const o = ctx.store.state.farm.objects[v.id];
      ctx.close();                                     // the panel covers the farm: look at it, then come back
      if (o && typeof view.focus === 'function') view.focus(o.x + Math.floor((g.nextSize?.[0] ?? 1) / 2), o.z + Math.floor((g.nextSize?.[1] ?? 1) / 2));
      clearInterval(growT);
      const t0 = performance.now();
      const paint = () => {
        if (performance.now() - t0 > 4500) { clearInterval(growT); view.highlight?.([], null); return; }
        view.highlight?.(blocked.length ? blocked : add, blocked.length ? '#FF4A3D' : '#7BE05A');
      };
      paint();
      growT = setInterval(paint, 250);
      const ui = ctx.ui;
      ui.toast(blocked.length ? t('farm.ani.redTiles', { why: blockText(g) }) : t('farm.ani.greenTiles', { home: N(v.def.id) }),
        { kind: 'info', icon: v.def.id, ms: 4500, action: { label: t('farm.ani.backTo', { home: N(v.def.id) }), fn: () => ui.panels.open('animals', { id: v.id }) } });
    }

    update(true);
    // opened from the Market's "Make room" (a full home that cannot grow): straight to the room step, what is in the way,
    // Show me and Move the home
    if (ctx.args.focus === 'room') {
      globalThis.requestAnimationFrame?.(() => body.querySelector('.pn-room-wrap, .pn-upgrade')?.scrollIntoView?.({ block: 'center' }));
    }
    return { update: () => update() };
  },
};

/** The growth preview's repaint timer: it outlives the panel (a phone closes its sheet to show the farm). */
let growT = 0;

/** The home's blue-ribbon line: how many have one and how close the next animal is. Pure. */
export function prizeLine(v) {
  if (!v || !v.animals.length) return null;
  const at = v.animals[0].prizedAt;
  const won = v.animals.filter((a) => a.prized).length;
  const next = v.animals.filter((a) => !a.prized).sort((a, b) => b.cycle - a.cycle || (a.id < b.id ? -1 : 1))[0] ?? null;
  const nm = v.species[0] ? plural(v.species[0].name, 2) : 'animals'; // i18n-ok: English word (Bulgarian: the species ref)
  const sp = v.species[0] ? N(v.species[0].id) : t('farm.ani.animalsWord');
  const text = !next ? t('farm.ani.allRibbons', { what: nm, sp })
    : won ? t('farm.ani.prizeWon', { won, c: next.cycle, at }) : t('farm.ani.prizeNext', { c: next.cycle, at });
  return { at, won, next, text };
}

/** The picture of a baby on its card: a fluffy yellow chick for a chicken (live requests 2026-10-04: "a baby chicken
 * should look like a real chick, not a small brown hen"), else the species' own icon. */
export const BABY_ICONS = Object.freeze({ chicken: 'chick' });
export const babyIcon = (def) => BABY_ICONS[def] ?? def;

/**
 * The plumage / coat tint of one animal, from its id (render's RD-22 picks the same three hen colours: chestnut,
 * buff, cream). The portrait backdrop shows it, so "the cream hen" in the panel is the cream hen in the coop. Pure.
 */
const TINTS = { chicken: ['#9A5B34', '#D2A86A', '#EBDDBB'] };
export function animalTint(id, def) {
  const list = TINTS[def];
  if (!list) return null;
  let x = 0x811c9dc5;                                  // FNV-1a: stable across sessions and both screens
  for (let i = 0; i < id.length; i++) { x ^= id.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
  return list[x % list.length];
}

function plural(name, n) {
  if (n === 1) return name.toLowerCase();
  if (/sheep$/i.test(name)) return name.toLowerCase();
  return `${name.toLowerCase()}s`;
}

