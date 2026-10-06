// The verifier's leftover-English findings after the Bulgarian translation (2026-10-06): each test is a spot that once
// printed a raw id or English in Bulgarian (or a key hint on a touch screen).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as I from '../public/js/i18n/index.js';
import { ledgerText } from '../public/js/ui/panels/goals-model.js';
import { CONTENT, PLACEABLES, RELICS, relicOf, itemOf } from '../shared/content/index.js';

const ROOT = new URL('..', import.meta.url).pathname;

/** Every .js file under a directory. */
function jsFiles(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? jsFiles(p) : p.endsWith('.js') ? [p] : [];
  });
}

/** The top-level arguments of a call whose '(' ends at `at` (strings, templates and brackets respected). */
function callArgs(src, at) {
  const args = [];
  let depth = 0;
  let cur = '';
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      // a string or a template: copy it whole (a template's ${…} may hold brackets of its own)
      let j = i + 1;
      let inner = 0;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (c === '`' && src[j] === '$' && src[j + 1] === '{') { inner++; j += 2; continue; }
        if (c === '`' && inner && src[j] === '}') { inner--; j++; continue; }
        if (src[j] === c && !inner) break;
        j++;
      }
      cur += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) { args.push(cur.trim()); return args; }
      depth--;
    }
    if (c === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return args;
}

// The functions that write a coin ledger row (shared/rules/economy.js) or pass a reason on to one, and the index of
// their `reason` argument. A reason that is a variable named `reason` is a pass-through (the helper's own parameter).
const COIN_CALLS = { earn: 3, grant: 3, spend: 3, refund: 3, refundCoins: 3, ledger: 3, pay: 3, payOut: 3, payReward: 4, payPrize: 4 };

/** Every ledger reason the rules can write: 'crate', 'sell:surplus', or a prefix 'town:' for `town:${id}`. */
function reasonsInRules() {
  const found = new Map();
  const re = new RegExp(`\\b(${Object.keys(COIN_CALLS).join('|')})\\(`, 'g');
  for (const file of jsFiles(join(ROOT, 'shared/rules'))) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(re)) {
      if (/function\s*$/.test(src.slice(Math.max(0, m.index - 12), m.index))) continue;     // its definition
      const line = src.slice(src.lastIndexOf('\n', m.index) + 1, m.index);
      if (/^\s*(\/\/|\*)/.test(line)) continue;                                            // a comment
      const arg = callArgs(src, m.index + m[0].length)[COIN_CALLS[m[1]]];
      const where = `${file.slice(ROOT.length)}: ${m[1]}(…, ${arg})`;
      assert.ok(arg !== undefined, `${where}: no reason argument`);
      if (arg === 'reason') continue;
      const lits = [...arg.matchAll(/'([^']*)'|`([^`$]*)\$\{/g)].map((x) => x[1] ?? `${x[2]}*`);
      assert.ok(lits.length > 0, `${where}: a coin reason this test cannot read`);
      for (const r of lits) found.set(r, where);
    }
  }
  return found;
}

const isLiveDef = (d) => d && !d.retired;
/** Content ids a `kind:` reason may carry, by kind (every one of them is checked). */
const REF_SAMPLES = {
  'buy:': () => [...PLACEABLES.keys()],
  'sell:': () => [...PLACEABLES.keys()],
  'undo:': () => [...PLACEABLES.keys()],
  'upgrade:': () => [...PLACEABLES.keys()],
  'slot:': () => [...CONTENT.buildings.keys()],
  'masterwork:': () => [...CONTENT.decor.keys()],
  'restore:': () => [...CONTENT.decor.keys(), ...CONTENT.restoration.keys()],
  'land:': () => [...CONTENT.expansions.keys()],
  'tool:': () => [...CONTENT.tools.values()].filter(isLiveDef).map((d) => d.id),
  'store:': () => [...CONTENT.items.keys()],
  'town:': () => [...CONTENT.townProjects.keys()],
  'furnish:': () => [...CONTENT.furniture.keys()],
  'relic:': () => RELICS.map((r) => r.id),
};

/** The English name a ref reason must say. */
function englishName(kind, id) {
  if (kind === 'relic:') return relicOf(id).name;
  if (kind === 'land:') return CONTENT.expansions.get(id).name;
  if (kind === 'tool:') return CONTENT.tools.get(id).name;
  if (kind === 'town:') return CONTENT.townProjects.get(id).name;
  if (kind === 'furnish:') return CONTENT.furniture.get(id).name;
  if (kind === 'restore:' && CONTENT.restoration.has(id)) return CONTENT.restoration.get(id).name;
  if (kind === 'store:') return itemOf(id).name;
  return PLACEABLES.get(id)?.name ?? CONTENT.decor.get(id)?.name ?? CONTENT.buildings.get(id)?.name;
}

test('the ledger: every reason the rules can write reads as words in English and in Bulgarian, never a raw id', async () => {
  const found = reasonsInRules();
  // the scanner itself works: it sees the reasons the verifier found printed raw
  for (const r of ['crate', 'barge', 'fair', 'townsfolk', 'track', 'weeds', 'petBreed', 'sell:surplus', 'undo:surplus',
    'furnish:*', 'town:*', 'relic:*', 'masterwork:*', 'buy:*', 'land:*', 'restore:*']) assert.ok(found.has(r), `the scanner missed '${r}'`);
  const reasons = [];
  for (const r of found.keys()) {
    if (!r.endsWith('*')) { reasons.push({ reason: r }); continue; }
    const kind = r.slice(0, -1);
    assert.ok(REF_SAMPLES[kind], `a new ledger reason kind '${kind}' (${found.get(r)}): give it words in goals-model.js ledgerText and samples here`);
    for (const id of REF_SAMPLES[kind]()) reasons.push({ reason: `${kind}${id}`, kind, id });
  }
  const problems = [];
  try {
    for (const l of ['en', 'bg']) {
      if (l === 'bg') await I.__loadForTest('bg'); else I.__setForTest('en');
      for (const { reason, kind, id } of reasons) {
        const s = ledgerText(reason);
        const bad = (why) => problems.push(`${l} '${reason}' -> "${s}": ${why}`);
        if (typeof s !== 'string' || !s) { bad('no text'); continue; }
        if (/undefined|null|NaN|[{}_]/.test(s)) bad('junk');
        if (s === reason || s.includes(reason.split(':')[0]) && /[a-z][A-Z]|^[a-z]/.test(s)) bad('the raw id');
        if (l === 'en') {
          if (!/^[A-Z]/.test(s)) bad('English starts with a capital');
          if (/[a-z][A-Z]/.test(s)) bad('a camelCase id');
          if (s.includes(':')) bad('the Journal prints English reasons without a colon');
          if (kind && !s.includes(englishName(kind, id))) bad(`names the ${kind.slice(0, -1)} "${englishName(kind, id)}"`);
        } else {
          if (/[A-Za-z]/.test(s)) bad('English (Latin letters) in Bulgarian');
          if (!/^[А-ЯЁ]/.test(s)) bad('Bulgarian starts with a capital (sentence case)');
        }
      }
    }
  } finally { I.__setForTest('en'); }
  assert.deepEqual(problems.slice(0, 40), [], `${problems.length} problems`);
});

test('the Feed Mill names every ingredient class of every feed (Rabbit Greens\' "veg"), in both languages', async () => {
  const { CLASS_LABEL } = await import('../public/js/ui/panels/building.js');
  const classes = new Set([...CONTENT.feeds.values()].flatMap((f) => (f.classes ?? []).map((c) => c.cls)));
  assert.ok(classes.has('veg'), 'Rabbit Greens takes a vegetable');
  try {
    for (const l of ['en', 'bg']) {
      if (l === 'bg') await I.__loadForTest('bg'); else I.__setForTest('en');
      for (const cls of classes) {
        const label = CLASS_LABEL?.[cls];
        assert.ok(typeof label === 'string' && label && label !== cls && !label.includes('.'), `${l}: the class '${cls}' has a label (got ${label})`);
        if (l === 'bg') assert.doesNotMatch(label, /[A-Za-z]/, `${l}: '${cls}' -> ${label}`);
      }
    }
  } finally { I.__setForTest('en'); }
});

test('the world floats: a bought upgrade tier and a tree\'s new age speak the language in effect, never the English name', async () => {
  const fx = await import('../public/js/render/fx.js');
  const { UPGRADES } = await import('../shared/rules/upgrades.js');
  const { TREE_AGE } = await import('../shared/content/index.js');
  assert.equal(typeof fx.upgradeTierName, 'function', 'fx.js names a tier through the names table');
  const tiers = Object.entries(UPGRADES).flatMap(([target, u]) => (u.tiers ?? []).map((row, i) => ({ target, tier: i + 1, name: row.name })));
  assert.ok(tiers.some((x) => x.name === 'Soft Cushions'), 'the verifier\'s tier is in the table');
  try {
    I.__setForTest('en');
    for (const ev of tiers) assert.equal(fx.upgradeTierName({ e: 'upgraded', ...ev }), ev.name);
    for (const s of TREE_AGE.stages) assert.equal(fx.treeAgeName(s.id), s.name, 'English says the stage\'s own name ("Mature"), not its id');
    await I.__loadForTest('bg');
    for (const ev of tiers) assert.doesNotMatch(fx.upgradeTierName({ e: 'upgraded', ...ev }), /[A-Za-z]/, `${ev.target}.${ev.tier}`);
    for (const s of TREE_AGE.stages) assert.doesNotMatch(fx.treeAgeName(s.id), /[A-Za-z]/, s.id);
  } finally { I.__setForTest('en'); }
  // the floats print those names, never the event's English `name` or a bare stage id
  const src = readFileSync(join(ROOT, 'public/js/render/fx.js'), 'utf8');
  assert.doesNotMatch(src, /ev\.name \? `\$\{ev\.name\}/, 'the upgrade float prints the translated tier name');
  assert.doesNotMatch(src, /ctext\('TREE_AGE', st, 'name', st\)/, 'the tree-age float has an English name, not the id');
});

test('a farmhouse piece clicked in the room is named and described in the language in effect (it printed the English)', async () => {
  const src = readFileSync(join(ROOT, 'public/js/game/interior.js'), 'utf8');
  assert.doesNotMatch(src, /\$\{def\.name\}|toast\(def\.name/, 'interior.js prints the furniture through the names table');
  try {
    await I.__loadForTest('bg');
    for (const d of CONTENT.furniture.values()) {
      if (!d.text) continue;
      const s = I.t('game.room.piece', { name: I.N(d.id, 'furniture'), text: I.ctext('furniture', d.id, 'desc', d.text) });
      assert.doesNotMatch(s, /[A-Za-z]/, `${d.id}: ${s}`);
    }
  } finally { I.__setForTest('en'); }
});

// A key named for a mouse: " (G)", "(Space)", "(колелце)", "Shift …", "R завърта", "Q и E".
const KEY_HINT = / \((?:[A-Z0-9]|(?:Ctrl|Shift|Alt)\+\w+|Space|Esc|Del|Enter|wheel|колелце)\)|\b(?:Shift|Esc|Escape|Space|Ctrl|Del|Enter)\b|\b[A-Z] (?:завърта|отказва|въртят|или|и) /;
// The lines a touch player reads through ui/dom.js touchText: HUD tooltips, the panel close title, the coach.
const TOUCH_KEYS = ['common.closeEsc', 'shell.html.barnTip', 'hud.barn.full', 'hud.barn.overflow', 'hud.barn.tip', 'hud.farmer.tipMe',
  'hud.farmer.tipOn', 'social.ping.tip', 'social.emotes.label', 'goals.j.dockHint', 'market.dock.hint', 'market.barn.dockHint',
  'market.orders.dockHint'];
const TOUCH_TEXTS = [['TUTORIAL', 'step.say_hello', 'text'], ['TUTORIAL', 'firstUse.hammer', 'text'], ['tools', 'hand', 'desc']];
// Every other Bulgarian line that names a key, and why a finger never reads it through touchText (reviewed 2026-10-06).
const NOT_ON_TOUCH = {
  'shell.photo.mode': 'a toast for the P key; English names it too',
  'shell.highFiveWait': 'a toast; English names the T key too',
  'shell.html.canvas': 'the canvas name for a mouse; a finger hears game.canvas.touch',
  'toolbar.hint.clickDel': 'the Hammer strip for a mouse; a finger reads toolbar.hint.tap',
  'toolbar.hint.rotateKey': 'a mouse button; a finger reads toolbar.hint.rotate',
  'toolbar.hint.backKey': 'a mouse button; a finger reads toolbar.hint.back',
  'toolbar.carry.cancel': 'the carry strip shows only for a mouse',
  'toolbar.ih.keys': 'the item bubble hides its key line from a finger',
  'settings.rightDragHelp': 'Settings: the mouse help',
  'settings.cap.middleDrag': 'Settings: the mouse keys list',
  'settings.cap.shiftClick': 'Settings: the mouse keys list',
  'social.ping.label': 'the button name for a screen reader; its tip has touch words',
  'game.seedFirst': 'a finger reads game.seedFirstTouch',
  'game.giant.fell': 'a toast; English names the Axe key too',
  'game.debris.axe': 'a toast; English names the Axe key too',
  'game.moved.stored': 'a toast; English names the B key too',
  'game.moved.storedPinned': 'a toast; English names the B key too',
  'game.ride.click': 'the world card line; English names the V key too',
  'game.fish.press': 'a finger reads game.fish.pressTouch',
  'market.decorSell.none': 'a panel line; English names the Del key too',
  'farm.m1b.rideTip': 'a panel line; English names the V key too',
  'home.fh.placingAria': 'a screen reader line for the keyboard',
  'text:features.uproot.card.text': 'the level-up card reads moments.touch.uproot to a finger',
  'text:features.pings.card.text': 'the level-up card reads moments.touch.pings to a finger',
};

test('touch parity: a Bulgarian line that names a key says its touch words to a finger, as English drops its key hints', async () => {
  const { touchText } = await import('../public/js/ui/dom.js');
  const { AREAS } = await import('../public/js/i18n/catalogs.js');
  const BG_TEXT = (await import('../public/js/i18n/bg/text.js')).default;
  const BG_NAMES = (await import('../public/js/i18n/bg/names.js')).default;
  const params = { name: 'Деси', title: 'Новак', total: 12, max: 50, cap: 40 };
  try {
    I.__setForTest('en');
    for (const k of TOUCH_KEYS) { const en = I.t(k, params); assert.notEqual(touchText(en, true), en, `English drops the key of ${k}`); }
    await I.__loadForTest('bg');
    for (const k of TOUCH_KEYS) {
      const bg = I.t(k, params);
      assert.match(bg, KEY_HINT, `${k} names its key for a mouse`);
      const touch = touchText(bg, true);
      assert.doesNotMatch(touch, KEY_HINT, `${k} on a touch screen: ${touch}`);
      assert.equal(touch, I.t(k, { ...params, $touch: true }));
      assert.equal(touchText(bg, false), bg, `${k} for a mouse`);
    }
    for (const [fam, id, field] of TOUCH_TEXTS) {
      const s = I.ctext(fam, id, field, 'English');
      assert.match(s, KEY_HINT, `${fam}.${id}.${field}`);
      assert.doesNotMatch(touchText(s, true), KEY_HINT, `${fam}.${id}.${field} on a touch screen: ${touchText(s, true)}`);
    }
    // the composite tips: a tool's (name + its tip) and the zoom buttons' (label + wheel) say their touch words in code
    const hud = readFileSync(join(ROOT, 'public/js/ui/hud.js'), 'utf8');
    assert.match(hud, /dataset\.tipTouch = label/);
    assert.match(readFileSync(join(ROOT, 'public/js/ui/toolbar.js'), 'utf8'), /dataset\.tipTouch = `\$\{name\}/);
  } finally { I.__setForTest('en'); }
  // every Bulgarian line that names a key: touch words, or a reviewed reason a finger never reads it through touchText
  const flat = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.entries(v).filter(([k]) => k !== 'touch').flatMap(([, x]) => flat(x)) : []);
  const unreviewed = [];
  for (const [, , load] of AREAS) {
    for (const [k, v] of Object.entries((await load()).default)) {
      if (!flat(v).some((s) => KEY_HINT.test(s))) continue;
      const hasTouch = v && typeof v === 'object' && Object.hasOwn(v, 'touch');
      if (TOUCH_KEYS.includes(k)) assert.ok(hasTouch, `${k} has touch words`);
      else if (!Object.hasOwn(NOT_ON_TOUCH, k)) unreviewed.push(k);
    }
  }
  const walk = (o, path) => {
    for (const [k, v] of Object.entries(o ?? {})) {
      if (k === 'touchText') continue;
      const p = `${path}.${k}`;
      if (typeof v === 'string' && KEY_HINT.test(v)) {
        const covered = TOUCH_TEXTS.some(([f, id, field]) => p === `text:${f}.${id}.${field}`) && typeof o.touchText === 'string';
        if (!covered && !Object.hasOwn(NOT_ON_TOUCH, p)) unreviewed.push(p);
      } else if (v && typeof v === 'object') walk(v, p);
    }
  };
  for (const [fam, rows] of Object.entries(BG_TEXT)) walk(rows, `text:${fam}`);
  for (const [id, e] of Object.entries(BG_NAMES.names)) {
    if (typeof e.desc === 'string' && KEY_HINT.test(e.desc) && !(typeof e.descTouch === 'string' && !KEY_HINT.test(e.descTouch))) unreviewed.push(`names:${id}.desc`);
  }
  assert.deepEqual(unreviewed, [], 'a Bulgarian line names a key: give it touch words ({ touch, other } / touchText / descTouch) or a reason here');
});

test('the landing page\'s meta description follows the language, like the rest of the page', async () => {
  const html = readFileSync(join(ROOT, 'public/landing.html'), 'utf8');
  const meta = html.match(/<meta name="description"[^>]*>/)?.[0] ?? '';
  const key = meta.match(/data-i18n-attr="content:([\w.]+)"/)?.[1];
  assert.ok(key, `the description is re-labelled with the page: ${meta}`);
  const en = (await import('../public/js/i18n/en/multi.js')).default;
  const bg = (await import('../public/js/i18n/bg/multi.js')).default;
  assert.equal(en[key], meta.match(/content="([^"]*)"/)[1], 'English stays the description it always was');
  assert.match(bg[key], /^Harvest Hollow: /, 'the brand in Latin letters');
  assert.doesNotMatch(bg[key].replace(/^Harvest Hollow: /, '').replace(/\b3D\b/, ''), /[A-Za-z]/, `Bulgarian: ${bg[key]}`);
});
