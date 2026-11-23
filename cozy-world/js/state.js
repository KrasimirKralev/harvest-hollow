// MNKISWAN Cozy World: authoritative, UI-independent transactions (port of scripts/game_state.gd). Every id is stable
// and serialized; a failed transaction changes nothing. Saves are versioned JSON in the browser's storage with a
// verified backup, and a broken primary falls back to the backup.
import { ITEMS, CROPS, DECOR, REGIONS, QUESTS, FISH, GUARDIANS, STALL_PRICES } from './data.js';

export const SAVE_VERSION = 1;
export const CAPACITY = 120;
export const DAY_SECONDS = 720;
export const SAVE_KEY = 'mnkiswan.cozyworld.save';
const SETTINGS_KEY = 'mnkiswan.cozyworld.settings';
const ANIMALS = ['chicken', 'cow', 'sheep'];
const CARE = ['pet', 'feed', 'brush', 'egg'];

const fresh = () => ({
  version: SAVE_VERSION, coins: 18, day: 1, clock: 120, inventory: {}, storage: {},
  seeds: { rice: 4, carrot: 3, tomato: 2, lettuce: 2, bloom: 2 }, plots: {}, gathered: {}, animals: {}, completed: [], flags: [],
  metrics: {}, visited: [], collection: [], guardians: [], decor_owned: ['basket'], decor_placed: {}, stall_tier: 0,
  position: [-29, 0.15, -21], interior: false,
});

const DEFAULT_SETTINGS = { music: 0.45, effects: 0.65, ambience: 0.4, sensitivity: 0.003, invert_y: false, reduced_motion: false,
  text_size: 1, easy_fishing: true };

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const finite = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function createState({ storage = globalThis.localStorage ?? null } = {}) {
  const listeners = { changed: new Set(), milestone: new Set() };
  const S = {
    data: fresh(),
    selectedCrop: 'rice',
    settings: { ...DEFAULT_SETTINGS },
    lastError: '',
    on(ev, fn) { listeners[ev].add(fn); return () => listeners[ev].delete(fn); },
  };
  const changed = (msg = '') => { for (const fn of listeners.changed) fn(msg); };
  const milestone = (id) => { for (const fn of listeners.milestone) fn(id); };
  const notify = (msg) => { changed(msg); return false; };

  S.reset = () => { S.data = fresh(); changed(''); };
  S.count = (id) => Number(S.data.inventory[id] ?? 0);
  S.metric = (id) => Number(S.data.metrics[id] ?? 0);
  S.record = (id, n = 1) => { S.data.metrics[id] = S.metric(id) + n; };
  S.used = () => Object.values(S.data.inventory).reduce((a, n) => a + Number(n), 0);
  S.totalTime = () => (S.data.day - 1) * DAY_SECONDS + S.data.clock;

  S.addItem = (id, n) => {
    if (!ITEMS[id] || n <= 0) return false;
    if (S.used() + n > CAPACITY) return notify('Your bag is full. Make room at home or at the stall.');
    S.data.inventory[id] = S.count(id) + n;
    if (!S.data.collection.includes(id)) S.data.collection.push(id);
    return true;
  };
  S.gather = (id, item, n = 2) => {
    if (Number(S.data.gathered[id] ?? 0) > S.totalTime()) return notify('Growing back gently. Try again later, or after a rest.');
    if (!S.addItem(item, n)) return false;
    S.data.gathered[id] = S.totalTime() + 150;
    S.record('gathered', n);
    changed(`+${n} ${ITEMS[item].name} · gathered with care`);
    return true;
  };
  S.available = (id) => Number(S.data.gathered[id] ?? 0) <= S.totalTime();

  S.tick = (dt) => {
    S.data.clock += dt;
    if (S.data.clock >= DAY_SECONDS) { S.data.clock -= DAY_SECONDS; S.data.day += 1; changed('A new day in Tree Village.'); }
    for (const p of Object.values(S.data.plots)) if (p.watered) p.growth = Math.min(p.growth + dt, CROPS[p.crop].seconds);
  };

  S.plant = (plotId, crop) => {
    if (!CROPS[crop] || S.data.plots[plotId]) return false;
    if (Number(S.data.seeds[crop] ?? 0) < 1) return notify(`No ${CROPS[crop].name} seeds left. Visit the market for more.`);
    S.data.seeds[crop] -= 1;
    S.data.plots[plotId] = { crop, watered: false, growth: 0 };
    S.record('planted');
    changed(`${CROPS[crop].name} planted. Give it a little water.`);
    return true;
  };
  S.water = (plotId) => {
    const p = S.data.plots[plotId];
    if (!p || p.watered) return false;
    p.watered = true;
    S.record('watered');
    changed('Watered. It will grow while you explore, or rest at home.');
    return true;
  };
  S.harvest = (plotId) => {
    const p = S.data.plots[plotId];
    if (!p || p.growth < CROPS[p.crop].seconds) return false;
    const y = CROPS[p.crop].yield;
    if (!S.addItem(p.crop, y)) return false;
    delete S.data.plots[plotId];
    S.record('harvested', y);
    changed(`A lovely harvest! +${y} ${ITEMS[p.crop].name}`);
    return true;
  };

  S.care = (animal, action) => {
    if (!ANIMALS.includes(animal) || !CARE.includes(action)) return false;
    const a = { ...(S.data.animals[animal] ?? {}) };
    if (Number(a[action] ?? 0) === S.data.day) return notify('Already cared for today. Your friend is content.');
    if (action === 'egg') {
      if (animal !== 'chicken' || Number(a.feed ?? 0) !== S.data.day) return notify('Feed the chicken first. A happy hen has a little gift.');
      if (!S.addItem('egg', 1)) return false;
    }
    if (action === 'feed') {
      if (S.count('berry') === 0 && S.count('lettuce') === 0) return notify('Bring a berry or leafy green for a little snack.');
      const food = S.count('lettuce') > 0 ? 'lettuce' : 'berry';
      S.data.inventory[food] -= 1;
    }
    if (!S.data.animals[animal]) S.record('animal_friends');
    a[action] = S.data.day;
    S.data.animals[animal] = a;
    changed(action === 'egg' ? 'A fresh egg, just for you.' : `${cap(animal)} enjoys a gentle ${action}. ♥`);
    return true;
  };

  S.catchFish = () => {
    const i = S.metric('caught') === 0 ? 0 : (S.data.day + S.metric('caught')) % FISH.length;
    const id = FISH[i];
    if (!S.addItem(id, 1)) return false;
    S.record('caught');
    changed(`A ${ITEMS[id].name}! A little patience goes a long way.`);
    milestone('fish');
    return true;
  };

  S.questUnlocked = (q) => q.requires.every((id) => S.data.completed.includes(id));
  S.questReady = (q) => {
    if (S.data.completed.includes(q.id) || !S.questUnlocked(q)) return false;
    for (const [id, n] of Object.entries(q.deliver)) if (S.count(id) < n) return false;
    for (const [id, n] of Object.entries(q.metrics)) if (S.metric(id) < n) return false;
    return true;
  };
  S.claimQuest = (id) => {
    const q = QUESTS.find((x) => x.id === id);
    if (!q || !S.questReady(q)) return false;
    for (const [item, n] of Object.entries(q.deliver)) S.data.inventory[item] -= n;
    S.data.completed.push(id);
    S.data.flags.push(q.flag);
    S.data.coins += q.coins;
    S.data.metrics.quests = S.data.completed.length;
    changed(`Request complete · ${q.title} · +${q.coins} coins`);
    milestone(id);
    return true;
  };
  S.reserved = (id) => {
    let n = 0;
    for (const q of QUESTS) if (S.questUnlocked(q) && !S.data.completed.includes(q.id)) n += Number(q.deliver[id] ?? 0);
    return Math.min(n, S.count(id));
  };
  S.sellable = (id) => Math.max(0, S.count(id) - S.reserved(id));
  S.sell = (id, qty) => {
    if (!ITEMS[id] || !Number.isInteger(qty) || qty <= 0 || qty > S.sellable(id)) return false;
    const value = ITEMS[id].price * qty;
    S.data.inventory[id] -= qty;
    S.data.coins += value;
    S.record('earned', value);
    changed(`Sold ${qty} ${ITEMS[id].name} · +${value} coins`);
    milestone('sale');
    return true;
  };
  S.buySeed = (crop) => {
    if (!CROPS[crop]) return false;
    const price = CROPS[crop].seed_cost;
    if (S.data.coins < price) return notify('A few more coins first. The stall is always here.');
    S.data.coins -= price;
    S.data.seeds[crop] = Number(S.data.seeds[crop] ?? 0) + 1;
    changed(`One ${CROPS[crop].name} seed tucked into your bag.`);
    return true;
  };
  S.upgrade = () => {
    const tier = S.data.stall_tier;
    if (tier >= STALL_PRICES.length) return false;
    if (S.data.coins < STALL_PRICES[tier]) return notify(`This improvement costs ${STALL_PRICES[tier]} coins.`);
    S.data.coins -= STALL_PRICES[tier];
    S.data.stall_tier += 1;
    S.record('upgrades');
    changed('Our fruit stall has room for more good things!');
    milestone('upgrade');
    return true;
  };
  S.buyDecor = (id) => {
    if (!DECOR[id] || S.data.decor_owned.includes(id)) return false;
    if (S.data.coins < DECOR[id].cost) return notify('Save a few more coins for this little treasure.');
    S.data.coins -= DECOR[id].cost;
    S.data.decor_owned.push(id);
    changed(`${DECOR[id].name} · ready to place at home.`);
    return true;
  };
  S.placeDecor = (id, anchor) => {
    if (!S.data.decor_owned.includes(id) || !Number.isInteger(anchor) || anchor < 0 || anchor > 9) return false;
    for (const k of Object.keys(S.data.decor_placed)) if (S.data.decor_placed[k] === id) delete S.data.decor_placed[k];
    S.data.decor_placed[String(anchor)] = id;
    S.data.metrics.decorated = Object.keys(S.data.decor_placed).length;
    changed('A little more like home. ♥');
    return true;
  };
  S.transfer = (id, n, toStorage) => {
    if (!ITEMS[id] || n <= 0) return false;
    const src = toStorage ? S.data.inventory : S.data.storage;
    const dst = toStorage ? S.data.storage : S.data.inventory;
    if (Number(src[id] ?? 0) < n) return false;
    if (!toStorage && S.used() + n > CAPACITY) return notify('Your bag is full.');
    src[id] -= n;
    dst[id] = Number(dst[id] ?? 0) + n;
    changed(toStorage ? 'Safely stored at home.' : 'Back in your bag.');
    return true;
  };
  S.discover = (id) => {
    if (!REGIONS.some((r) => r.id === id) || S.data.visited.includes(id)) return false;
    S.data.visited.push(id);
    S.data.metrics.regions = S.data.visited.length;
    changed('');
    return true;
  };
  S.guardian = (id) => {
    if (!GUARDIANS.includes(id) || S.data.guardians.includes(id)) return false;
    S.data.guardians.push(id);
    S.data.metrics.guardians = S.data.guardians.length;
    changed(`${cap(id)} guardian remembered · ${S.data.guardians.length} / 3`);
    return true;
  };
  S.rest = () => {
    S.tick(DAY_SECONDS - S.data.clock);
    S.data.clock = 120;
    changed(`Day ${S.data.day} · A fresh morning. Nothing is ever lost by resting.`);
  };

  // ---- saves ----
  S.validate = (c) => validate(c);
  const read = (key) => { try { return storage ? storage.getItem(key) : null; } catch { return null; } };
  const write = (key, v) => { try { storage.setItem(key, v); return true; } catch { return false; } };
  S.hasSave = () => Boolean(read(SAVE_KEY) || read(`${SAVE_KEY}.bak`));
  S.save = () => {
    if (!storage) return notify('This browser cannot keep a save here.');
    if (!validate(S.data)) { S.lastError = 'Save validation failed; your previous save is safe.'; return notify(S.lastError); }
    const text = JSON.stringify(S.data);
    if (!validate(JSON.parse(text))) return false;
    // only a verified primary becomes the backup; a good backup is never overwritten with corruption
    const prev = read(SAVE_KEY);
    if (prev && parses(prev)) write(`${SAVE_KEY}.bak`, prev);
    if (!write(SAVE_KEY, text)) return notify('Could not finish saving; the browser storage is full. Your previous save remains safe.');
    changed('Saved · your little world is safe.');
    return true;
  };
  S.load = () => {
    for (const key of [SAVE_KEY, `${SAVE_KEY}.bak`]) {
      const t = read(key);
      if (!t) continue;
      let c = null;
      try { c = JSON.parse(t); } catch { c = null; }
      if (validate(c)) { S.data = c; changed(key === SAVE_KEY ? 'Welcome home.' : 'Recovered your world from its backup.'); return true; }
    }
    S.lastError = 'No valid save found. Your existing save files have been kept.';
    return notify(S.lastError);
  };
  S.saveSettings = () => write(SETTINGS_KEY, JSON.stringify(S.settings));
  S.loadSettings = () => {
    let c = null;
    try { c = JSON.parse(read(SETTINGS_KEY) ?? 'null'); } catch { c = null; }
    if (!isObj(c)) return;
    for (const k of Object.keys(DEFAULT_SETTINGS)) if (typeof c[k] === typeof DEFAULT_SETTINGS[k]) S.settings[k] = c[k];
    for (const k of ['music', 'effects', 'ambience']) S.settings[k] = Math.min(1, Math.max(0, S.settings[k]));
    S.settings.sensitivity = Math.min(0.008, Math.max(0.001, S.settings.sensitivity));
  };
  S.loadSettings();
  return S;
}

function parses(t) { try { return validate(JSON.parse(t)); } catch { return false; } }

/** True when `c` is a complete, sane save of this version. Pure. */
export function validate(c) {
  if (!isObj(c) || c.version !== SAVE_VERSION) return false;
  const base = fresh();
  for (const k of Object.keys(base)) {
    if (!(k in c)) return false;
    if (Array.isArray(base[k]) !== Array.isArray(c[k]) || typeof base[k] !== typeof c[k]) return false;
  }
  if (!finite(c.coins, 0, 1e7) || !finite(c.day, 1, 1e6) || !finite(c.clock, 0, DAY_SECONDS) || !finite(c.stall_tier, 0, 3)) return false;
  if (c.position.length !== 3 || !c.position.every((v) => finite(v, -300, 300))) return false;
  let total = 0;
  for (const key of ['inventory', 'storage']) {
    if (!isObj(c[key])) return false;
    for (const [id, n] of Object.entries(c[key])) {
      if (!ITEMS[id] || !finite(n, 0, 1e6)) return false;
      if (key === 'inventory') total += n;
    }
  }
  if (total > CAPACITY) return false;
  for (const [id, n] of Object.entries(c.seeds)) if (!CROPS[id] || !finite(n, 0, 1e5)) return false;
  for (const p of Object.values(c.plots)) {
    if (!isObj(p) || !CROPS[p.crop] || typeof p.watered !== 'boolean' || !finite(p.growth, 0, 1e4)) return false;
  }
  for (const v of Object.values(c.gathered)) if (!finite(v, 0, 1e9)) return false;
  for (const [id, a] of Object.entries(c.animals)) {
    if (!ANIMALS.includes(id) || !isObj(a)) return false;
    for (const [act, d] of Object.entries(a)) if (!CARE.includes(act) || !finite(d, 1, 1e6)) return false;
  }
  for (const v of Object.values(c.metrics)) if (!finite(v, 0, 1e9)) return false;
  for (const key of ['completed', 'flags', 'visited', 'collection', 'guardians', 'decor_owned']) {
    if (!c[key].every((x) => typeof x === 'string') || new Set(c[key]).size !== c[key].length) return false;
  }
  if (!c.completed.every((id) => QUESTS.some((q) => q.id === id))) return false;
  if (!c.visited.every((id) => REGIONS.some((r) => r.id === id))) return false;
  if (!c.collection.every((id) => ITEMS[id])) return false;
  if (!c.guardians.every((id) => GUARDIANS.includes(id))) return false;
  if (!c.decor_owned.every((id) => DECOR[id])) return false;
  const placed = new Set();
  for (const [anchor, id] of Object.entries(c.decor_placed)) {
    const n = Number(anchor);
    if (!/^\d+$/.test(anchor) || n < 0 || n > 9 || !c.decor_owned.includes(id) || placed.has(id)) return false;
    placed.add(id);
  }
  return typeof c.interior === 'boolean';
}
