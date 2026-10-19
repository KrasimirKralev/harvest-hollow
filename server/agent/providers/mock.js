// The mock provider (harness contract §5.5): a scripted agent for tests and dev, on only with HH_HARNESS_MOCK=1
// (refused with NODE_ENV=production by agent config). It signs in through a page of our own and then plays a script
// chosen by a word in the request, calling the same six tools a real agent gets:
//   (default)  Moon Melon (crop) + Melon Pie (recipe) + a letter from Mabel; validate, preview, summary
//   "fail"     writes a crop with a growMin off the ladder first, reads the errors, fixes it, validates again
//   "broken"   writes the bad crop and never fixes it (the job ends `failed` after the fix rounds)
//   "slow"     every step takes five times longer
//   "now"/"сега"  the Moon Melon unlocks at the farm's own level (request.md), so a young farm can plant it at once
//   "nothing"  writes no mod file, only summary.json with "possible": false (release 1.0, H1: the job ends `answered`)
//   "fixture:<name>"  plays mock-fixtures/<name>.json (release 1.0, H9: the honesty set's scripted answers): writes its
//              `files` (null removes a file), calls validate, writes `fix` when the check failed (a refused knob taken
//              out), validates again, then writes its `summary`
//   a follow-up request ("ask for changes") adds a Moon Lantern decoration on top.
// The files are the guide's own examples, so they are what the validator accepts for real.
import path from 'node:path';
import fsp from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson, randomHex } from '../fsutil.js';

/** The scripted answers of `fixture:<name>` (one JSON file each). */
export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'mock-fixtures');

/** A fixture by name ({ files?, fix?, summary }), or null. */
export async function readFixture(name) {
  if (!/^[a-z0-9_-]{1,40}$/.test(String(name))) return null;
  try { return JSON.parse(await fsp.readFile(path.join(FIXTURES, `${name}.json`), 'utf8')); } catch { return null; }
}

const userKey = (u) => `${u.farmKey}/${u.pid}`;
const j = (v) => `${JSON.stringify(v, null, 2)}\n`;

export const MOCK_FILES = Object.freeze({
  'mod/mod.json': { format: 1, title: { en: 'Moonlight Harvest', bg: 'Лунна жътва' } },
  crop: {
    id: 'x_moon_melon', like: 'watermelon', growMin: 90, yield: 3, unlock: 14, value: 'normal', season: 'summer',
    classes: ['fruit'], hue: '#BFE3FF', waterable: true,
    text: {
      en: { name: 'Moon Melon', desc: 'A pale melon that glows at dusk' },
      bg: { name: 'Лунен пъпеш', g: 'm', pl: 'лунни пъпеши', count: 'лунни пъпеша', def: 'лунният пъпеш',
        defObj: 'лунния пъпеш', plDef: 'лунните пъпеши', desc: 'Блед пъпеш, който свети привечер' },
    },
  },
  recipe: {
    id: 'x_melon_pie', like: 'pumpkin_pie', building: 'pie_oven', minutes: 45, unlock: 15,
    inputs: { x_moon_melon: 2, flour: 1 }, value: 'normal', hue: '#F2C14E',
    text: {
      en: { name: 'Melon Pie' },
      bg: { name: 'Пай с пъпеш', g: 'm', pl: 'пайове с пъпеш', count: 'пая с пъпеш', def: 'паят с пъпеш',
        defObj: 'пая с пъпеш', plDef: 'пайовете с пъпеш' },
    },
  },
  letters: [{
    id: 'x_letter_melons', from: 'mabel', art: 'melon',
    en: { title: 'Melons by moonlight', body: 'Dear both, I hear something pale and round is growing on your farm. I hope it glows for you on summer nights!' },
    bg: { title: 'Пъпеши под луната', body: 'Мили мои, чух, че на фермата ви расте нещо бледо и кръгло. Дано ви свети в летните нощи!' },
  }],
  decor: {
    id: 'x_moon_lantern', like: 'lantern', cost: 600, hue: '#9FD3E8',
    text: {
      en: { name: 'Moon Lantern', desc: 'A soft blue light for quiet evenings' },
      bg: { name: 'Лунен фенер', g: 'm', pl: 'лунни фенери', count: 'лунни фенера', def: 'лунният фенер',
        defObj: 'лунния фенер', plDef: 'лунните фенери', desc: 'Мека синя светлина за тихите вечери' },
    },
  },
  summary: {
    en: 'Moon Melons grow in summer from level 14, and the Pie Oven bakes a Melon Pie from them. Mabel wrote you a letter about it.',
    bg: 'От ниво 14 през лятото растат лунни пъпеши, а пещта за пайове пече от тях пай с пъпеш. Мейбъл ти написа писмо.',
  },
  // "now" (release 1.0, H5): the melon at the farm's level; the pie keeps its oven's level 15, and says so
  summaryNow: {
    en: 'You can plant Moon Melons now; from level 15 the Pie Oven bakes a Melon Pie from them. Mabel wrote you a letter about it.',
    bg: 'Лунните пъпеши можеш да садиш още сега; от ниво 15 пещта за пайове пече от тях пай с пъпеш. Мейбъл ти написа писмо.',
  },
  summaryNothing: {
    en: 'I cannot give you coins: prices and rewards are the game\'s own, so a change cannot set them. I can make your crops grow a little faster instead.',
    bg: 'Не мога да ти дам монети: цените и наградите са на играта и промяна не може да ги задава. Мога вместо това да направя посевите ти малко по‑бързи.',
    possible: false,
    try: [{ en: 'Crops grow 20% faster', bg: 'Посевите да растат с 20 % по‑бързо' }],
  },
  summaryLantern: {
    en: 'I added a Moon Lantern to the shop, a soft blue light for your evenings. Everything from before is still there.',
    bg: 'Добавих лунен фенер в магазина – мека синя светлина за вечерите. Всичко от преди си остава.',
  },
});

/**
 * @param {{ cfg: object, log: object, hostDir: string, now?: () => number, notify?: Function }} o
 */
export function createProvider({ cfg, now = Date.now, notify = () => {} }) {
  const pending = new Map();          // state -> { user, expiresAt }
  const pendingOf = new Map();        // userKey -> state
  const mark = (user) => path.join(user.dir, 'mock-signin.json');

  const sleep = (ms, signal) => new Promise((resolve) => {
    if (signal && signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });

  async function status(user) {
    const st = pendingOf.get(userKey(user));
    const p = st && pending.get(st);
    if (p && p.expiresAt > now()) {
      return { provider: 'mock', state: 'pending', step: { kind: 'open_url', url: `/api/harness/mock/signin?state=${st}`, expiresAt: p.expiresAt,
        paste: { field: 'code' } } };
    }
    const m = await readJson(mark(user));
    return m ? { provider: 'mock', state: 'signed_in', account: { label: 'Mock farmer' } } : { provider: 'mock', state: 'signed_out' };
  }

  async function finish(user) {
    const st = pendingOf.get(userKey(user));
    if (st) pending.delete(st);
    pendingOf.delete(userKey(user));
    await writeJson(mark(user), { at: now() });
    const s = await status(user);
    notify(user, s);
    return s;
  }

  return {
    id: 'mock',
    available: async () => ({ ok: true, version: 'mock' }),
    models: async () => [{ id: 'mock-small', label: 'Mock' }],
    signIn: {
      async start(user) {
        const old = pendingOf.get(userKey(user));
        if (old) pending.delete(old);
        const st = randomHex(16);
        pending.set(st, { user, expiresAt: now() + 10 * 60_000 });
        pendingOf.set(userKey(user), st);
        return status(user);
      },
      async continue(user, { code } = {}) {
        if (!pendingOf.get(userKey(user))) return status(user);
        if (typeof code !== 'string' || !code.trim()) return { provider: 'mock', state: 'error', error: { code: 'BAD_CODE' } };
        return finish(user);
      },
      status,
      async signOut(user) {
        const st = pendingOf.get(userKey(user));
        if (st) pending.delete(st);
        pendingOf.delete(userKey(user));
        await fsp.rm(mark(user), { force: true });
        return { provider: 'mock', state: 'signed_out' };
      },
      /** A sign-in started and not finished is forgotten (H4); a finished one stays. */
      async cancel(user) {
        const st = pendingOf.get(userKey(user));
        if (st) pending.delete(st);
        pendingOf.delete(userKey(user));
        return status(user);
      },
    },
    /** GET /api/harness/mock/signin?state= (the "sign-in page" of the mock) */
    async callback({ state }) {
      const p = pending.get(String(state || ''));
      if (!p || p.expiresAt <= now()) return null;
      return { user: p.user, state: await finish(p.user) };
    },
    owns: (state) => pending.has(String(state || '')),

    async run(job, io) {
      const words = job.prompts.map((p) => p.text.toLowerCase()).join(' ');
      const slow = /\bslow\b/.test(words) ? 5 : 1;
      const step = () => sleep(cfg.mockStepMs * slow, io.signal);
      const t = io.tools;
      const stopped = () => io.signal && io.signal.aborted;
      let turns = 0;
      const call = async (name, args = {}) => { turns++; return t[name](args); };
      const content = (family, def) => `mod/content/${family}/${def.id}.json`;

      io.emit({ type: 'step', step: 'reading' });
      const req = await call('read_file', { path: 'request.md' });
      await call('read_file', { path: 'docs/mod-guide.md' });
      await call('list_files', { dir: 'docs/catalog' });
      await step();
      if (stopped()) return { ok: false, code: 'CANCELLED', turns };

      io.emit({ type: 'step', step: 'building' });
      const fx = /fixture:([a-z0-9_-]+)/.exec(words);
      if (fx) return playFixture(fx[1]);
      if (/\bnothing\b/.test(words)) {
        await call('write_file', { path: 'summary.json', content: j(MOCK_FILES.summaryNothing) });
        await step();
        return { ok: true, turns };
      }
      const broken = /\bbroken\b/.test(words);
      const failFirst = /\bfail\b/.test(words) && !/full check found/.test(req.content || '');
      const lvl = /The farm is at level (\d+)\./.exec(req.content || '');
      const now = /\bnow\b|(?:^|\s)сега(?:$|[\s.,!])/.test(words) && lvl ? { unlock: Math.max(1, Math.min(14, Number(lvl[1]))) } : {};
      const crop = { ...MOCK_FILES.crop, ...now, ...(broken || failFirst ? { growMin: 100 } : {}) };
      await call('write_file', { path: 'mod/mod.json', content: j(MOCK_FILES['mod/mod.json']) });
      await call('write_file', { path: content('crops', crop), content: j(crop) });
      await call('write_file', { path: content('recipes', MOCK_FILES.recipe), content: j(MOCK_FILES.recipe) });
      await call('write_file', { path: 'mod/text/letters.json', content: j(MOCK_FILES.letters) });
      const revising = job.prompts.length > 1;
      if (revising) await call('write_file', { path: content('decor', MOCK_FILES.decor), content: j(MOCK_FILES.decor) });
      await step();
      if (stopped()) return { ok: false, code: 'CANCELLED', turns };

      io.emit({ type: 'step', step: 'testing' });
      let v = await call('validate');
      await step();
      if (!v.ok && failFirst && !broken) {
        // read the errors, fix the ladder value, check again: what a real agent does
        await call('edit_file', { path: content('crops', crop), old: '"growMin": 100', new: '"growMin": 90' });
        v = await call('validate');
        await step();
      }
      if (stopped()) return { ok: false, code: 'CANCELLED', turns };
      if (v.ok) await call('preview');
      const said = revising ? MOCK_FILES.summaryLantern : now.unlock && now.unlock < MOCK_FILES.crop.unlock ? MOCK_FILES.summaryNow : MOCK_FILES.summary;
      await call('write_file', { path: 'summary.json', content: j(said) });
      await step();
      if (stopped()) return { ok: false, code: 'CANCELLED', turns };
      return { ok: true, turns };

      /** A scripted answer: write, check, take out what the check refused, answer. */
      async function playFixture(name) {
        const spec = await readFixture(name);
        if (!spec) return { ok: false, code: 'PROVIDER', detail: `no fixture ${name}`, turns };
        const writeAll = async (files) => {
          for (const [rel, v] of Object.entries(files ?? {})) await call('write_file', { path: `mod/${rel}`, content: v === null ? '' : j(v) });
        };
        await writeAll(spec.files);
        await step();
        if (stopped()) return { ok: false, code: 'CANCELLED', turns };
        if (spec.files && Object.keys(spec.files).length) {
          io.emit({ type: 'step', step: 'testing' });
          let v = await call('validate');
          if (!v.ok && spec.fix) { await writeAll(spec.fix); v = await call('validate'); }
          if (v.ok) await call('preview');
        }
        if (spec.summary) await call('write_file', { path: 'summary.json', content: j(spec.summary) });
        await step();
        return stopped() ? { ok: false, code: 'CANCELLED', turns } : { ok: true, turns };
      }
    },
    cancel() { /* run() stops on io.signal */ },
    forget(farmKey) {
      for (const [st, p] of pending) if (p.user.farmKey === farmKey) { pending.delete(st); pendingOf.delete(userKey(p.user)); }
    },
  };
}
