// Wave-5 hub (the owners' wish list of 2026-10-05), ui lane: the moments of the new rules on both screens. Small, loaded
// at boot (no panel of its own): a pair in the pen ❤ and the baby that comes of it (list 1, wish 1), the dog that stays
// home or comes along (list 2, wish 3), and once per farmer the word that the land now comes in fewer, bigger parcels
// (list 2, wish 4). The words come from the events (both farmers get them: the actor's predicted, the partner's from
// the delta) and from the replicated state, never from a local guess.
//
//   bornText(state, ev) / pairText(state, ev, me) / stayText(state, ev, me) -> string | null   (pure; tests)
//   landNotice(state, pid, seen) -> { key, message } | null                                      (pure; tests)
//   installW5(ui, { store }) -> uninstall
import { kv } from '../dom.js';
import { defOf } from '../../../../shared/content/index.js';
import { PAIR_EVENTS, BORN_EVENTS, STAY_EVENTS, petOf, landUnits, unitOwned, landFamily } from './w5-rules.js';
import { feedRows } from '../../../../shared/rules/feed.js';
import { animalLabel } from './pen-pair.js';
import { babyNoun } from './nursery.js';
import { t, list, N, name as cname } from '../../i18n/index.js';

const nameOf = (state, pid, me) => (pid === me ? t('common.you') : state?.players?.[pid]?.name ?? t('common.partner'));
const homeDefOf = (state, ev) => {
  const id = ev.home ?? null;
  const o = id && state?.farm?.objects?.[id];
  return o?.def ?? (typeof ev.hd === 'string' ? ev.hd : null);
};
const speciesOf = (state, ev) => ev.species ?? state?.farm?.objects?.[ev.a]?.def ?? state?.farm?.objects?.[ev.id]?.def ?? null;

/** "A calf was born in the Cow Barn! 🍼" (both screens). Pure but for the language. */
export function bornText(state, ev) {
  const sp = speciesOf(state, ev);
  const hd = homeDefOf(state, ev);
  const noun = sp ? babyNoun(sp) : t('farm.pair.baby');
  return hd && defOf(hd) ? t('farm.pair.born', { noun, home: N(hd) }) : t('farm.pair.bornAny', { noun });
}

/** The partner's ❤: "Mia paired Bella and Daisy ❤ a calf is on its way". Null for my own (the panel shows it). */
export function pairText(state, ev, me) {
  if (!ev || ev.by === me) return null;
  const sp = speciesOf(state, ev);
  const noun = sp ? babyNoun(sp) : t('farm.pair.baby');
  const a = ev.a && state?.farm?.objects?.[ev.a] ? animalLabel(state, ev.a) : null;
  const b = ev.b && state?.farm?.objects?.[ev.b] ? animalLabel(state, ev.b) : null;
  return a && b ? t('farm.pair.partner', { name: nameOf(state, ev.by, me), a, b, noun })
    : t('farm.pair.partnerAny', { name: nameOf(state, ev.by, me), noun });
}

/** "Rex stays home 🏠" (mine) / "Mia's Rex stays home now 🏠" (the partner's). Pure but for the language. */
export function stayText(state, ev, me) {
  const owner = ev.pid ?? ev.owner ?? ev.by;
  const pet = petOf(state, owner);
  const name = pet?.name ?? ev.name ?? t('game.pet.the');
  const stay = ev.stay === true;
  // the other farmer told this pet (the rules let either farmer tell either pet)
  if (ev.by && ev.by !== owner && ev.by !== me && ev.by !== 'sys') return t(stay ? 'home.pets.toldStay' : 'home.pets.toldCome', { name: nameOf(state, ev.by, me), pet: name });
  if (owner === me || ev.by === me) return t(stay ? 'home.pets.nowStays' : 'home.pets.nowFollows', { name });
  return t(stay ? 'home.pets.partnerStays' : 'home.pets.partnerFollows', { name, owner: nameOf(state, owner, me) });
}

/**
 * The once-per-farmer word about the bigger land (a farm the migration touched; `seen` = the record this device already
 * told this farmer about). { key, message } or null. Pure but for the language.
 */
export function landNotice(state, pid, seen) {
  if (!pid) return null;
  // the rules' one-time migration (`_land`, run at the server's boot before anyone connects) leaves its feed line
  const row = feedRows(state).map(([, r]) => r).find((r) => r && r.k === 'land');
  if (!row) return null;
  const key = `feed|${row.at}`;
  if (seen === key) return null;
  const parcels = landUnits().filter((u) => u.k > 0);
  const owned = parcels.filter((u) => unitOwned(state, u)).map((u) => cname(u.id, { family: landFamily() }));
  const message = owned.length
    ? t('farm.land.merged', { n: parcels.length, list: list(owned) })
    : t('farm.land.mergedNone', { n: parcels.length });
  return { key, message };
}

export default function installW5(ui, { store } = {}) {
  if (!store || typeof store.on !== 'function') return () => {};
  const off = [];
  const seenKey = () => `land.seen.${store.pid}`;
  const tellLand = () => {
    const st = store.state;
    if (!st || !store.pid || !ui.banner) return;
    let n = null;
    try { n = landNotice(st, store.pid, kv.get(seenKey(), null)); } catch (err) { console.error('w5 land notice failed', err); }
    if (!n) return;
    kv.set(seenKey(), n.key);
    ui.banner({ id: 'land-merged', kind: 'quest', ribbon: t('farm.land.ribbon'), ttl: 16000,
      message: () => landNotice(store.state, store.pid, null)?.message ?? n.message,
      things: [],
      actions: [{ label: () => t('farm.land.open'), kind: 'sky', fn: () => ui.panels.open('landmap') }] });
  };
  // the welcome (a reload, a new device) and any later change: the first state that carries the record tells it once
  off.push(store.on('welcome', () => setTimeout(tellLand, 2500)));
  if (store.state) setTimeout(tellLand, 2500);
  off.push(store.on('fx', ({ ev, by, local }) => {
    if (!ev || typeof ev.e !== 'string') return;
    const st = store.state;
    try {
      if (PAIR_EVENTS.has(ev.e)) {
        const text = local ? null : pairText(st, { ...ev, by: ev.by ?? by }, store.pid);
        if (text) ui.toast(text, { kind: 'info', icon: speciesOf(st, ev) ?? 'heart', ms: 5000,
          action: ev.home ? { label: t('farm.pair.look'), fn: () => ui.panels.open('animals', { id: ev.home }) } : undefined });
        return;
      }
      if (BORN_EVENTS.has(ev.e)) {
        // a birth is the farm's (a system action at the due time): both screens, once, with the way to name it
        const id = ev.id ?? null;
        const home = ev.home ?? (id ? st?.farm?.objects?.[id]?.home : null) ?? null;
        ui.banner?.({ id: `born-${id ?? ev.home ?? ''}`, kind: 'quest', ribbon: t('farm.pair.bornRibbon'), ttl: 10000,
          message: () => bornText(store.state, ev), things: [],
          actions: home ? [{ label: () => t('farm.pair.nameIt'), kind: 'sky', fn: () => ui.panels.open('animals', { id: home }) }] : [] });
        return;
      }
      if (STAY_EVENTS.has(ev.e)) {
        const owner = ev.pid ?? ev.owner ?? ev.by ?? by;
        const e2 = { ...ev, pid: owner, by: ev.by ?? by };
        // my own command answers at once (predicted); the other farmer's arrives with the delta
        if (local || e2.by !== store.pid) {
          ui.toast(() => stayText(store.state, e2, store.pid), { kind: 'info', icon: 'dog_house', ms: 3500 });
        }
      }
    } catch (err) {
      console.error('w5 moment failed', err);
    }
  }));
  return () => { for (const f of off.splice(0)) { try { f?.(); } catch { /* gone */ } } };
}
