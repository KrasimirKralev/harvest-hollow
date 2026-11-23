// The interface (port of scripts/ui.gd): the title, the HUD (place card, day and coins, the tracked request, the
// prompt, Mnki & Swan), toasts and place banners, and every menu: pause, bag, journal / village board, map, the
// stall, home, a villager's words, animal care and settings. Menus pause the world.
import { ITEMS, CROPS, DECOR, REGIONS, QUESTS, METRIC_NAMES, STALL_PRICES, STALL_NAMES } from './data.js';
import { CAPACITY } from './state.js';
import { mapCanvas } from './map.js';

function h(tag, props = {}, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  // a first argument that is text, a node or a list is a child, not the props
  if (props === null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) { kids.unshift(props); props = {}; }
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style') el.style.cssText = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) el.append(k instanceof Node ? k : String(k));
  return el;
}
const portrait = (id, cls = 'portrait') => h(`img.${cls}`, { src: `assets/portraits/${id}.webp`, alt: id === 'couple' ? 'Mnki and Swan' : id === 'mnki' ? 'Mnki' : 'Swan' });
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function createUI(game) {
  const S = game.state;
  const $ = (id) => document.getElementById(id);
  const root = $('ui');
  let modal = null; let page = ''; let shopTab = 'sell'; let homeTab = 'rest'; let animalId = '';
  let toastT = 0; let bannerT = 0;
  const ui = { tracked: 'welcome', get isOpen() { return Boolean(modal); }, page: () => page };

  // ---- title ----
  function buildTitle() {
    const t = $('title');
    const has = S.hasSave();
    t.replaceChildren(
      h('div.title-band'),
      h('div.title-left',
        h('div.kicker', 'M N K I S W A N'),
        h('h1.serif', 'Cozy World'),
        h('p.tagline.serif', 'A little world worth', h('br'), 'returning to — together.'),
        h('p.lede', 'Wander the woodland paths with Mnki and Swan. Grow a garden, share a harvest, and turn a tiny village into a place that feels like home.'),
        h('div.title-actions',
          h('button.btn.primary.big', { type: 'button', on: { click: () => (has ? confirmNew() : game.begin(false)) } }, 'Begin our story   →'),
          has ? h('button.btn', { type: 'button', on: { click: () => game.begin(true) } }, 'Continue our world') : null,
          h('button.btn', { type: 'button', on: { click: () => open('settings') } }, 'Settings & controls'),
          h('a.btn.link', { href: '../' }, '← Back to Tree Village')),
        h('div.small', 'NO RUSH. NO WRONG TURNS. JUST US.')),
      h('div.title-art', portrait('couple', 'couple')),
      h('div.title-foot', 'A WOODLAND LIFE SIMULATION · ORIGINAL CHARACTER REFERENCES · MNKISWAN'));
    t.hidden = false;
    t.querySelector('.btn.primary')?.focus();
  }
  function confirmNew() {
    shell('A fresh beginning', 'Your existing world stays safe until you save the new one.');
    body(para('Starting again replaces your active world when you next save. You can continue your current world instead.', 'big'),
      btn('Start a new world', () => { close(); game.begin(false); }, true),
      btn('Keep our current world', () => close()));
  }

  // ---- HUD ----
  function showHud() { $('title').hidden = true; $('hud').hidden = false; close(); }
  function hideHud() { $('hud').hidden = true; }
  function updateHud() {
    if ($('hud').hidden) return;
    const d = S.data; const r = game.region;
    $('region-name').textContent = r.name;
    $('region-sub').textContent = `TREE VILLAGE · ${String(d.visited.length).padStart(2, '0')} / 13 PLACES`;
    let compass = r.subtitle;
    if (game.waypoint) {
      const w = REGIONS.find((x) => x.id === game.waypoint);
      if (w) compass = `◇ ${w.name} · ${Math.round(Math.hypot(game.pos().x - w.p[0], game.pos().z - w.p[1]))}m`;
    }
    $('region-compass').textContent = compass;
    const hours = Math.floor(6 + (d.clock / 720) * 24) % 24;
    const minutes = Math.floor((((d.clock / 720) * 24) % 1) * 60);
    $('stats').textContent = `DAY ${d.day}    ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}     ◉ ${d.coins}`;
    const q = QUESTS.find((x) => x.id === ui.tracked) ?? QUESTS[0];
    $('quest-title').textContent = q.title;
    $('quest-detail').textContent = `${d.completed.includes(q.id) ? 'Complete · choose another request [J]' : progress(q)}\nVillage board · J for requests`;
    const p = $('prompt');
    if (game.fishing) {
      p.hidden = false;
      p.classList.toggle('bite', game.fishing.bite);
      p.textContent = game.fishing.bite ? '[E] REEL IT IN!   ·   a bite!' : 'Waiting for a little nibble…   ·   Right-click or Esc to cancel';
    } else if (game.target && !modal) {
      p.hidden = false; p.classList.remove('bite');
      p.textContent = `[E] ${game.promptOf(game.target)}`;
    } else p.hidden = true;
  }
  function progress(q) {
    const lines = [];
    for (const [id, n] of Object.entries(q.deliver)) lines.push(`${ITEMS[id].name} ${Math.min(S.count(id), n)}/${n}`);
    for (const [id, n] of Object.entries(q.metrics)) lines.push(`${METRIC_NAMES[id] ?? id} ${Math.min(S.metric(id), n)}/${n}`);
    return lines.join(' · ');
  }
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    toastT = 5.5;
    t.hidden = !text;
  }
  function banner(title, subtitle) {
    $('banner').replaceChildren(h('div.banner-title.serif', title), h('div.banner-sub', subtitle));
    bannerT = 4;
    $('banner').hidden = false;
  }
  function tick(dt) {
    toastT = Math.max(0, toastT - dt);
    if (toastT <= 0) $('toast').hidden = true;
    bannerT = Math.max(0, bannerT - dt);
    $('banner').hidden = bannerT <= 0 || Boolean(modal);
  }

  // ---- modal shell ----
  let bodyEl = null;
  function shell(title, subtitle = '') {
    if (modal) modal.remove();
    game.setMenu(true);
    bodyEl = h('div.modal-body');
    modal = h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div.modal-dim', { on: { click: () => close() } }),
      h('div.modal-panel',
        h('div.modal-head', h('div', h('h2.serif', title), subtitle ? h('div.muted.small', subtitle) : null),
          h('button.btn', { type: 'button', on: { click: () => close() } }, 'Close  ×')),
        h('hr'), bodyEl,
        h('div.modal-foot.small.muted', 'YOUR TIME IS YOURS. MENUS PAUSE THE WORLD.        Esc · return')));
    root.append(modal);
    modal.querySelector('.modal-head .btn').focus();
  }
  const body = (...kids) => bodyEl.append(...kids.flat().filter(Boolean));
  const para = (text, cls = '') => h(`p.para${cls ? `.${cls}` : ''}`, text);
  const btn = (text, fn, primary = false, disabled = false) => h(`button.btn${primary ? '.primary' : ''}`, { type: 'button', disabled, on: { click: fn } }, text);
  const card = (...kids) => h('div.card', ...kids);
  const row = (...kids) => h('div.row', ...kids);
  const grow = (...kids) => h('div.grow', ...kids);
  function close() {
    if (modal) modal.remove();
    modal = null; page = '';
    game.setMenu(!game.playing);
    if (!game.playing) $('title').hidden = false;
  }
  function refresh() { const p = page; if (p) open(p); }

  function open(p) {
    page = p;
    switch (p) {
      case 'pause': pausePage(); break;
      case 'inventory': inventoryPage(); break;
      case 'journal': journalPage(false); break;
      case 'board': journalPage(true); break;
      case 'map': mapPage(); break;
      case 'shop': shopPage(); break;
      case 'home': homePage(); break;
      case 'settings': settingsPage(); break;
      case 'animal': animalPage(animalId); break;
      default:
    }
    page = p;
  }

  function pausePage() {
    const d = S.data;
    shell('A little breather', `Day ${d.day} · ${d.completed.length} requests complete · ${d.visited.length} / 13 places discovered`);
    body(portrait('couple', 'couple-small'),
      btn('Return to our world', () => close(), true),
      btn('Save our world', () => game.saveWorld()),
      btn('Settings & controls', () => open('settings')),
      btn('Save & return to title', () => { if (!game.saveWorld()) return; game.toTitle(); }));
  }

  function inventoryPage() {
    shell('Our little satchel', `${S.used()} / ${CAPACITY} items · ◉ ${S.data.coins} coins · seeds have their own pocket`);
    body(para('Ingredients for available village requests are reserved when trading. Store or retrieve items at home.'));
    let any = false;
    for (const [id, it] of Object.entries(ITEMS)) {
      const n = S.count(id);
      if (n <= 0) continue;
      any = true;
      body(card(row(h('span.dot', { style: `color:${it.color}` }, '●'),
        grow(h('div.name', it.name), h('div.small.muted', `${it.category} · ${it.price} coins each · ${S.reserved(id)} reserved for requests`)),
        h('span.count', `× ${n}`))));
    }
    if (!any) body(para('An empty bag is the beginning of a good walk. Look for ripe berries beside the forest path.', 'big'));
    body(h('div.section', 'THE SEED POCKET'));
    for (const [crop, c] of Object.entries(CROPS)) {
      body(row(grow(`${c.name} seeds`), h('span', `× ${S.data.seeds[crop] ?? 0}`),
        btn(S.selectedCrop === crop ? 'Selected ✓' : 'Select', () => { S.selectedCrop = crop; refresh(); })));
    }
  }

  function journalPage(atBoard) {
    shell(atBoard ? 'Village requests' : 'Our story so far', `${S.data.completed.length} / 12 requests complete · no deadlines, just little acts of care`);
    if (!atBoard) body(para('Track a request here. Deliver ingredients and collect rewards at the community board in Village Park.'));
    for (const q of QUESTS) {
      const done = S.data.completed.includes(q.id);
      const unlocked = S.questUnlocked(q);
      const ready = S.questReady(q);
      const c = card(row(h('div.qtitle.serif', `${done ? '✓ ' : '◇ '}${q.title}`), h('div.grow'), h('span.sage', `◉ ${q.coins}`)),
        para(`${q.giver} · ${q.text}`));
      if (done) { c.classList.add('done'); c.append(h('div.sage.small', 'A kindness remembered.')); } else if (!unlocked) {
        c.append(h('div.small.muted', `Unlocks after: ${q.requires.map((id) => QUESTS.find((x) => x.id === id)?.title ?? id).join(', ')}`));
      } else {
        c.append(para(progress(q), 'ink'));
        const acts = row(btn(ui.tracked === q.id ? 'Tracking ✓' : 'Track request', () => { ui.tracked = q.id; refresh(); }));
        if (atBoard) {
          acts.append(btn(ready ? 'Deliver & receive reward' : 'Still a little to do', () => {
            if (S.claimQuest(q.id)) game.saveWorld();
            if (page) refresh();
          }, ready, !ready));
        }
        c.append(acts);
      }
      body(c);
    }
    body(h('h3.serif', 'OUR NATURE JOURNAL'),
      para(S.data.collection.length ? `Discovered: ${S.data.collection.map((id) => ITEMS[id].name).join(', ')}` : 'The first page is waiting for a discovery.'));
  }

  function mapPage() {
    shell('A map of our little world', `${S.data.visited.length} / 13 places discovered · warm paths always lead home`);
    const here = S.data.interior ? REGIONS[9].p : [game.pos().x, game.pos().z];
    const pin = (r) => { game.waypoint = r.id; toast(`Pinned · ${r.name}`); close(); };
    body(mapCanvas(S, here, pin));
    for (const r of REGIONS) body(row(grow(`${S.data.visited.includes(r.id) ? '✓ ' : '○ '}${r.name}`), btn('Pin on compass', () => pin(r))));
  }

  function shopPage() {
    shell('Mnki & Swan’s fruit stall', `◉ ${S.data.coins} coins · stall tier ${S.data.stall_tier + 1} / 4 · grown with care, shared with love`);
    body(row(...['sell', 'seeds', 'decor', 'improvements'].map((t) => btn(cap(t), () => { shopTab = t; refresh(); }, shopTab === t))));
    if (shopTab === 'sell') {
      body(para('Choose a quantity and check its price before selling. Ingredients for available requests stay safe in your bag.'));
      let any = false;
      for (const [id, it] of Object.entries(ITEMS)) {
        if (S.count(id) <= 0) continue;
        any = true;
        const max = S.sellable(id);
        const qty = h('input.qty', { type: 'number', min: max > 0 ? 1 : 0, max, step: 1, value: max });
        const sell = btn(`Sell · +${max * it.price} coins`, () => { S.sell(id, Math.min(max, Math.max(1, Math.floor(Number(qty.value))))); refresh(); }, true, max === 0);
        qty.addEventListener('input', () => { sell.textContent = `Sell · +${Math.max(0, Math.min(max, Math.floor(Number(qty.value) || 0))) * it.price} coins`; });
        body(card(row(grow(h('div.name', it.name), h('div.small.muted', `${S.count(id)} in bag · ${S.reserved(id)} reserved · ${it.price} coins each`)), qty, sell)));
      }
      if (!any) body(para('Your baskets are empty. The berry maze, orchard and fishing pond are waiting.', 'big'));
    } else if (shopTab === 'seeds') {
      body(para('All crops are gentle. Plant, water, explore or rest, then harvest. Nothing withers.'));
      for (const [crop, c] of Object.entries(CROPS)) {
        body(card(row(grow(h('div.name', `${c.name} seed`), h('div.small.muted', `${S.data.seeds[crop] ?? 0} owned · grows in ${c.seconds}s when watered · yield ${c.yield}`)),
          btn(`Buy · ${c.seed_cost} coins`, () => { S.buySeed(crop); refresh(); }, true))));
      }
    } else if (shopTab === 'decor') {
      body(para('Choose a little treasure. Place it at one of ten anchors inside your shared treehouse.'));
      for (const [id, d] of Object.entries(DECOR)) {
        const owned = S.data.decor_owned.includes(id);
        body(card(row(grow(h('div.name', d.name)), btn(owned ? 'Owned ✓' : `Buy · ${d.cost} coins`, () => { S.buyDecor(id); refresh(); }, !owned, owned))));
      }
    } else {
      for (let i = 0; i < 3; i++) {
        body(card(row(grow(h('div.name', STALL_NAMES[i])),
          btn(S.data.stall_tier > i ? 'Built ✓' : `Improve · ${STALL_PRICES[i]} coins`, () => { S.upgrade(); refresh(); }, S.data.stall_tier === i, S.data.stall_tier !== i))));
      }
    }
  }

  function homePage() {
    shell('Our treehouse', `A place for quiet mornings and small treasures · ◉ ${S.data.coins}`);
    body(row(...['rest', 'storage', 'decorate'].map((t) => btn(cap(t), () => { homeTab = t; refresh(); }, homeTab === t))));
    if (homeTab === 'rest') {
      body(portrait('couple', 'couple-small'),
        para('A new morning brings ripe fruit and a fresh start. Watered crops keep growing. Nothing is lost by resting.', 'big'),
        btn('Rest until morning & save', () => { S.rest(); game.saveWorld(); refresh(); }, true),
        btn('Save our world', () => game.saveWorld()));
    } else if (homeTab === 'storage') {
      body(para('Home storage is separate from your satchel. Move one item at a time; everything stays accounted for.'));
      for (const [id, it] of Object.entries(ITEMS)) {
        const home = Number(S.data.storage[id] ?? 0);
        if (S.count(id) + home <= 0) continue;
        body(card(row(grow(h('div.name', it.name), h('div.small.muted', `Bag ${S.count(id)} · Home ${home}`)),
          btn('Store 1 →', () => { S.transfer(id, 1, true); refresh(); }, false, S.count(id) === 0),
          btn('← Take 1', () => { S.transfer(id, 1, false); refresh(); }, false, home === 0))));
      }
    } else {
      body(para('Place a treasure at an anchor. Replacing an anchor returns its previous decoration to your collection. Each owned item can appear once.'));
      for (let anchor = 0; anchor < 10; anchor++) {
        const placed = S.data.decor_placed[String(anchor)] ?? '';
        const choice = h('select', {}, ...S.data.decor_owned.map((id) => h('option', { value: id }, DECOR[id].name)));
        body(card(row(grow(h('div.name', `${anchor < 5 ? 'Living room' : 'Upstairs'} · anchor ${(anchor % 5) + 1}`), h('div.small.muted', placed ? DECOR[placed].name : 'An empty space')),
          choice, btn('Place here', () => { S.placeDecor(choice.value, anchor); game.saveWorld(); refresh(); }, true))));
      }
    }
  }

  function dialogue(name, line, art = '') {
    shell(name, 'A moment together');
    page = 'dialogue';
    body(art ? portrait(art, 'dialogue-art') : null, h('p.quote', `“${line}”`),
      btn('Let’s keep exploring', () => close(), true), btn('Read our journal', () => open('journal')));
  }

  function animalMenu(id) { animalId = id; open('animal'); }
  function animalPage(id) {
    shell(`A gentle hello, ${id}`, 'Little friends, never a chore');
    body(para('Offer a berry or leafy green, brush gently, or simply say hello. There are no penalties for missing a day. Each care action is remembered for today.', 'big'));
    const words = { pet: 'Gently pet', feed: 'Offer food · 1 berry or leafy green', brush: 'Brush their coat', egg: 'Collect today’s egg' };
    for (const action of ['pet', 'feed', 'brush', 'egg']) {
      if (action === 'egg' && id !== 'chicken') continue;
      const done = Number(S.data.animals[id]?.[action] ?? 0) === S.data.day;
      body(btn(words[action] + (done ? ' · done for today ✓' : ''), () => {
        if (S.care(id, action)) { game.sound.play('pick'); game.react(0.6); }
        refresh();
      }, !done, done));
    }
  }

  function settingsPage() {
    shell('Make yourself comfortable', 'Saved in this browser · audio, camera, readability and controls');
    body(h('div.section', 'SOUND & CAMERA'));
    const slider = (name, id, lo, hi, step) => {
      const v = h('span.small.muted', S.settings[id].toFixed(id === 'sensitivity' ? 4 : 2));
      const s = h('input', { type: 'range', min: lo, max: hi, step, value: S.settings[id] });
      s.addEventListener('input', () => { S.settings[id] = Number(s.value); S.saveSettings(); game.sound.volumes(); v.textContent = Number(s.value).toFixed(id === 'sensitivity' ? 4 : 2); });
      body(row(h('span.setting', name), s, v));
    };
    const toggle = (name, id) => {
      const c = h('input', { type: 'checkbox', checked: S.settings[id] });
      c.addEventListener('change', () => { S.settings[id] = c.checked; S.saveSettings(); });
      body(h('label.toggle', c, ` ${name}`));
    };
    slider('Music', 'music', 0, 1, 0.05);
    slider('Woodland ambience', 'ambience', 0, 1, 0.05);
    slider('Action sounds', 'effects', 0, 1, 0.05);
    slider('Mouse sensitivity', 'sensitivity', 0.001, 0.008, 0.0005);
    toggle('Invert vertical camera', 'invert_y');
    toggle('Reduce decorative character motion', 'reduced_motion');
    toggle('Relaxed fishing · generous bite window', 'easy_fishing');
    body(row(h('span.setting', 'Text size'), btn('Standard', () => setText(1)), btn('Large', () => setText(1.15))));
    body(h('div.section', 'CONTROLS'),
      h('table.keys', ...[['Move', 'W A S D / arrow keys'], ['Look', 'Mouse (click the world to look around)'], ['Interact · reel after a bite', 'E'],
        ['Jump / run', 'Space / Shift'], ['Camera distance', 'Mouse wheel'], ['Select seed', '1–5 (rice, carrot, tomato, greens, bloom)'],
        ['Swap Mnki and Swan', 'Q'], ['Bag / journal / map', 'I or Tab / J / M'], ['Pause or close menu', 'Esc'],
        ['Save / hide HUD', 'F5 or Ctrl+S / F2']]
        .map(([a, k]) => h('tr', h('td', a), h('td', h('kbd', k))))),
      para('Esc closes menus and pauses. Mouse wheel adjusts camera distance. No stamina, hunger, crop death or deadlines.'));
  }
  function setText(v) { S.settings.text_size = v; S.saveSettings(); document.documentElement.style.setProperty('--text', String(v)); refresh(); }
  document.documentElement.style.setProperty('--text', String(S.settings.text_size));

  // HUD buttons
  for (const [id, p] of [['btn-bag', 'inventory'], ['btn-journal', 'journal'], ['btn-map', 'map']]) $(id).addEventListener('click', () => open(p));

  Object.assign(ui, { buildTitle, showHud, hideHud, updateHud, toast, banner, tick, open, close, refresh, dialogue, animalMenu, progress });
  return ui;
}
