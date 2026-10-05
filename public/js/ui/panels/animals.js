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

const lazy = (f) => ({ type: () => f().type, args: () => f().args });

const STATUS = {
  baby: 'Growing',
  hungry: 'Hungry',
  producing: 'Making',
  ready: 'Ready!',
};

export const animalsPanel = {
  title: (args, state) => (state ? homeView(state, args.id, 0)?.name ?? 'Animals' : 'Animals'),
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
      if (!v) { body.append(empty("This home isn't on the farm any more.", 'barn')); return; }
      ctx.setTitle(v.name);
      const st = ctx.store.state;
      const sp = v.species[0];
      const mastery = sp ? starsOf(st, 'animals', sp.id) : null;
      const prize = prizeLine(v);
      body.append(
        h('div.pn-bhead',
          h('div.pn-bhead-art', icon(v.def.id, { size: 72 })),
          h('div.pn-bhead-text',
            h('p.pn-bhead-status', `${fmt(v.animals.length)} of ${fmt(v.cap)} ${sp ? plural(sp.name, v.cap) : 'animals'}`,
              v.ready ? pill(`${v.ready} ready`, 'pn-owned') : null, v.hungry ? pill(`${v.hungry} hungry`, 'pn-warn') : null),
            h('div.pn-feedline', ...v.feeds.map((f) => h('span.pn-feed', chip(f.item, { n: f.have, size: 28, tab: true }),
              h('span', `${itemOf(f.item)?.name} in the barn${f.keep ? ` (keeping ${fmt(f.keep)})` : ''}`))),
            mastery && levelOf(st) >= MASTERY.unlock ? h('span.pn-mast', { title: mastery.next ? `★${mastery.stars + 1} at ${fmt(mastery.next)} collections` : 'Top mastery' },
              stars(mastery.stars), `${fmt(mastery.count)} collected`) : null,
            // one blue-ribbon line for the whole home, not "0/60 to a blue ribbon" under every animal (UI-37)
            prize ? h('div.pn-ani-prize.pn-home-prize', { title: `A blue ribbon after ${fmt(prize.at)} collections: then a 10 % chance of a special good` },
              rosette(prize.next ? 1 : 2, 18), prize.next ? bar(prize.next.cycle / prize.at, null, 'pn-thin pn-ribbonbar') : null, h('small', prize.text)) : null)),
          h('div.pn-bhead-acts',
            kit.button({ label: 'Tend all', glyph: 'check', cls: 'btn--sun', ...lazy(() => I.tend(v.id)), data: { tend: v.id },
              hint: () => {
                const cur = view();
                const left = cur && Number.isFinite(cur.nextAt) ? cur.nextAt - ctx.now() : null;
                const what = itemOf(sp?.product)?.name?.toLowerCase() ?? 'product';
                return { missing: v.feeds.filter((f) => f.have === 0).map((f) => ({ item: f.item, n: 1 })),
                  texts: { NOT_READY: left !== null ? `All tended · next ${what} in ${fmtDuration(left)}` : 'Nothing to tend right now' } };
              } }),
            sp && sp.feed === null ? null : kit.button({ label: 'Pet all', glyph: 'hand', cls: 'pn-sm btn--sky', ...lazy(() => I.pet(v.id)), data: { pet: v.id },
              hint: { done: 'Everyone has had a pat today' } }))),
        animalGrid(v),
        // the M1b species' own section: truffles, the pond, the goat, the horse (Ride), the hive's forage (ui-collect)
        ...[m1bSection(v, ctx)].filter(Boolean),
        footer(v));
      kit.refresh();
      kit.tick();
    }

    function animalGrid(v) {
      const grid = h('div.pn-animals', { role: 'list' });
      if (!v.animals.length) grid.append(empty(`No ${v.species[0] ? plural(v.species[0].name, 2).toLowerCase() : 'animals'} yet. Buy one below!`, 'heart'));
      const st = ctx.store.state;
      for (const a of v.animals) {
        const fill = bar(0, null, a.status === 'baby' ? 'pn-thin pn-go' : 'pn-thin pn-sky');
        const line = h('span.pn-ani-state');
        if (a.status === 'baby' || a.status === 'producing') {
          kit.timer(line, { end: a.end, start: a.start, bar: fill, prefix: a.status === 'baby' ? 'grown in ' : `${itemOf(a.def.product)?.name ?? 'product'} in `, done: () => update(true) });
        } else {
          // one reason per hungry animal: the line says what it wants AND whether the barn has it; the Feed button
          // then stays quiet about NO_ITEMS (it used to repeat "Need 1 more Chicken Feed" under "Wants 1 Chicken Feed")
          const feedName = itemOf(a.feed)?.name ?? 'feed';
          const haveFeed = (v.feeds.find((f) => f.item === a.feed)?.have ?? 0) >= a.feedQty;
          line.textContent = a.status === 'ready' ? `${itemOf(a.def.product)?.name ?? 'Product'} waiting`
            : haveFeed ? `Wants ${a.feedQty} ${feedName}` : `Wants ${a.feedQty} ${feedName}: none in the barn`;
        }
        // a Beehive's colony is never petted (GDD §3.4 Bees)
        const hearts = a.def.feed === null ? null : h('span.pn-ani-pet', { title: a.petBy.length ? `Petted today by ${a.petBy.map((p) => st.players[p]?.name ?? p).join(' and ')}` : 'Not petted today' },
          ...(a.petBy.length ? a.petBy.map((p) => h('span.pn-heart', { style: { '--who': st.players[p]?.color ?? '#E8556E' } }, '♥')) : [h('span.pn-heart.off', '♡')]));
        const q = (a.status === 'baby' || a.status === 'producing') && levelOf(st) >= BOOSTS.hurry.unlock ? hurryQuote(st, a.id, ctx.now()) : null;
        const hurry = q ? kit.button({ label: `${q.acorns}`, glyph: 'acorn', cls: 'pn-xs btn--sun pn-hurry', title: a.baby ? 'Hurry: grown up now' : 'Hurry: ready now',
          ...lazy(() => I.hurry(a.id)), data: { hurry: a.id },
          hint: () => ({ acorns: Math.max(0, (hurryQuote(ctx.store.state, a.id, ctx.now())?.acorns ?? 0) - ctx.store.state.farm.wallet.acorns) }) }) : null;
        const act = a.status === 'baby'
          ? kit.button({ label: 'Bottle', icon: a.bottle, cls: 'pn-xs btn--sky', ...lazy(() => I.bottle(a.id)), data: { bottle: a.id },
            title: `${itemOf(a.bottle)?.name}: 30 % less time to grow up`, hint: () => ({ missing: [{ item: a.bottle, n: 1 }] }) })
          : a.status === 'producing' ? null
            : kit.button({ label: a.status === 'ready' ? 'Collect' : 'Feed', cls: 'pn-xs', ...lazy(() => I.tend(a.id)), data: { tend: a.id },
              hint: () => ({ missing: [{ item: a.feed, n: a.feedQty }] }), quiet: a.status === 'hungry' ? ['NO_ITEMS'] : null });
        const prize = a.prized ? ribbonTag('Blue ribbon', 'pn-try') : null;
        // a chick is yellow whatever hen it grows into: its backdrop is a soft straw yellow
        const tint = a.baby ? (BABY_ICONS[a.def.id] ? '#F6DE7A' : null) : animalTint(a.id, a.def.id);
        grid.append(h(`article.pn-ani.${a.status}`, { role: 'listitem', dataset: { animal: a.id } },
          h('div.pn-ani-art', { style: tint ? { '--tint': tint } : null, dataset: { tint: tint ? 'on' : 'off' } },
            icon(a.baby ? babyIcon(a.def.id) : a.def.id, { size: a.baby ? 50 : 60 }), a.baby ? h('span.pn-ani-baby', 'baby') : null),
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
      const shown = a.name || a.def.name;
      const btn = h('button.pn-name', { type: 'button', dataset: { key: `name-${a.id}` },
        title: a.name ? `Named by ${st.players[a.namedBy]?.name ?? 'you two'}. Click to rename.` : `Give this ${a.def.name.toLowerCase()} a name`,
        on: { click: () => {
          const input = h('input.pn-input.pn-name-input', { maxlength: '16', value: a.name || '', placeholder: 'A name…', 'aria-label': `Name for this ${a.def.name}` });
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
        return kit.confirmButton({ label: 'Undo buy', cls: 'pn-xs pn-ghost', confirm: `Refund ${fmt(a.paid)}?`, ...lazy(() => I.refund(a.id)) });
      }
      const back = a.free ? 0 : Math.floor((a.paid * (a.prized ? 10_000 : 5000)) / 10_000);
      return kit.confirmButton({ label: 'Sell', cls: 'pn-xs pn-ghost', confirm: back ? `Sell for ${fmt(back)}?` : 'Let it go?', ...lazy(() => I.sellObject(a.id)) });
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
          h('div.pn-upgrade-text', h('b', `Another ${sp.name.toLowerCase()}`),
            h('span', `${fmt(placedOf(st, sp.id).length)} on the farm · baby grows up in ${durationText(sp.babyMs)}`)),
          buyRow(v, sp, false, baby), buyRow(v, sp, true, adult),
          // a full home makes room for the next one itself (wave 4b): its room step is in the price
          v.room === 0 && quoteOf(v, sp, false)?.step > 0 ? h('small.pn-buyani-note', `Includes making room: +${fmt(quoteOf(v, sp, false).step)} coins`
            + `${quoteOf(v, sp, false).grows ? `, the ${v.name} grows bigger` : ''}`) : null));
      }
      if (v.species[0]?.feed !== null) out.append(h('p.pn-hint', `Petting lasts until midnight: +10 % chance of a bonus ${v.species[0] ? itemOf(v.species[0].product)?.name.toLowerCase() : 'product'}, +${COOP.petting.bothBp / 100} % when both of you petted it.`));
      return out;
    }

    const quoteOf = (v, sp, adult) => buyQuote(ctx.store.state, sp.id, adult, v.id);
    /** One "Baby / Adult · price · Buy" row; its price includes the room step when the home has to grow for it. */
    function buyRow(v, sp, adult, base) {
      const q = quoteOf(v, sp, adult);
      const coins = () => buyQuote(ctx.store.state, sp.id, adult, v.id)?.coins ?? priceOf(ctx.store.state, sp.id, { adult }).coins;
      const g = homeGrowth(ctx.store.state, v.id);
      return h('div.pn-buyani-row', h('span', adult ? 'Adult' : 'Baby'), price(q && q.code === null ? { coins: q.coins } : base),
        kit.button({ label: 'Buy', cls: 'pn-xs', ...lazy(() => I.buyAnimal(sp.id, adult, v.id)), data: { buy: sp.id, adult: String(adult) },
          hint: () => ({ coins: Math.max(0, coins() - ctx.store.state.farm.wallet.coins), cap: g?.max ?? v.cap,
            texts: { BLOCKED: `No room to grow: ${blockText(g)}`, OUT_OF_BOUNDS: `No room to grow: the ${v.name} is at the edge of your land` } }) }));
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
        return h('div.pn-upgrade', h('div.pn-upgrade-text', h('b', 'As roomy as it gets'), h('span', `${fmt(g?.max ?? v.max)} is the most this home holds.`)));
      }
      const blocked = g.code === 'BLOCKED' || g.code === 'OUT_OF_BOUNDS';
      const row = h(`div.pn-upgrade.pn-room${blocked ? '.blocked' : ''}`, { dataset: { room: v.id } },
        h('div.pn-upgrade-text', h('b', `Make room: ${fmt(g.cap)} → ${fmt(g.next)}`),
          h('span', g.grows ? `The ${v.name} grows to ${sz(g.nextSize)} for it · up to ${fmt(g.max)}` : `Room for ${fmt(g.max)} at most · buying one for a full home makes the room too`)),
        price({ coins: g.coins }),
        kit.button({ label: 'Upgrade', glyph: 'hammer', cls: 'pn-sm', ...lazy(() => I.upgradeHome(v.id)), data: { upgradehome: v.id },
          quiet: ['BLOCKED', 'OUT_OF_BOUNDS'], hint: () => ({ coins: Math.max(0, g.coins - ctx.store.state.farm.wallet.coins) }) }));
      if (!g.grows) return row;
      const acts = h('div.pn-room-acts',
        h('button.pn-chipbtn', { type: 'button', dataset: { showgrow: v.id }, on: { click: () => showGrowth(v, g) } }, blocked ? 'Show me' : 'Show where'),
        blocked && ctx.controller?.move ? h('button.pn-chipbtn.pn-room-move', { type: 'button', dataset: { movehome: v.id },
          on: { click: () => { ctx.close(); ctx.controller.move(v.id); } } }, `Move the ${v.name}`) : null);
      const why = blocked ? h('p.pn-room-why', { role: 'note' }, `To grow to ${sz(g.nextSize)} the ${v.name} needs the tiles around it: `
        + `${blockText(g)}. Move ${g.blockers.length > 1 ? 'them' : 'it'}, or move the ${v.name} somewhere roomier.`) : null;
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
      ui.toast(blocked.length ? `Red tiles: ${blockText(g)}` : `The ${v.name} grows into the green tiles`,
        { kind: 'info', icon: v.def.id, ms: 4500, action: { label: `Back to the ${v.name}`, fn: () => ui.panels.open('animals', { id: v.id }) } });
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
  const nm = v.species[0] ? plural(v.species[0].name, 2) : 'animals';
  const text = !next ? `Every one of your ${nm} has a blue ribbon`
    : `${won ? `${fmt(won)} with a blue ribbon · ` : ''}next one at ${fmt(next.cycle)}/${fmt(at)} collections`;
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

