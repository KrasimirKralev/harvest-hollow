// Picking a pair for the Breeding Barn on the farm itself (GDD §3.4 Breeding Barn, L28, M2; rules:
// shared/rules/actions/breeding.js `breed { a, b }`). The breeding panel (ui-home) offers "Pick on the farm"; the
// controller then turns the Hand into a matchmaker: the first click picks an adult (its species' other adults glow:
// their homes are highlighted), the second click on another adult of the same species starts the breeding (2 Baby
// Bottles, or 2 Chicken Feed for poultry; the rules decide). A click on a home picks its first eligible adult. Esc, a
// right click or another tool ends the mode. Everything is checked by the rules' own dry run before it is sent.
//
//   pairable(state, id, now) -> null | ERR code     an adult of a breedable species (BREEDING.species), not a colony
//   partnersFor(state, a, now) -> [id]             the other adults of a's species (sorted)
//   animalName(state, id) -> 'Daisy' | 'Cow'       the name the couple gave it (farm.names), else its species
//   pairWords(state, a, b) -> 'Daisy and Clover' | 'Daisy and a Cow' | 'Two Cows'
//   createPairing({ store, view, toast, perform }) -> pairing
//     pairing.start(firstId?, species?) -> boolean / pairing.pick(id) -> { ok, done?, code? } / pairing.cancel()
//     pairing.active / first / species / candidates / text / refresh() (re-lay the homes' glow)
//     pairing.on('pair', fn)      { active, first, species, candidates, text } (game/mode-chip.js, the breeding panel)
import { animalOf, BREEDING, defOf } from '../../../shared/content/index.js';
import { footprint, occupantsOf } from '../../../shared/rules/grid.js';
import { ERR } from '../../../shared/net/protocol.js';
import { canRun as dryRun } from './targets.js';

const objectOf = (state, id) => (state && typeof id === 'string' && Object.hasOwn(state.farm.objects, id) ? state.farm.objects[id] : null);

/** null when `id` is an adult that could be paired (the rules check the rest: bottles, room, one breeding at a time). */
export function pairable(state, id, now) {
  const o = objectOf(state, id);
  const def = o ? animalOf(o.def) : null;
  if (!o || !def || typeof o.home !== 'string') return ERR.NOT_FOUND;
  if (def.feed === null || !(BREEDING?.species ?? []).includes(def.id)) return ERR.BAD_ARGS;    // bees swarm, never pair
  if (Number.isFinite(o.adultAt) && o.adultAt > now) return ERR.NOT_READY;
  return null;
}

/** The other adults of a's species (sorted ids). */
export function partnersFor(state, a, now) {
  const o = objectOf(state, a);
  if (!o) return [];
  return Object.keys(state.farm.objects).sort()
    .filter((id) => id !== a && state.farm.objects[id].def === o.def && pairable(state, id, now) === null);
}

/** The name the couple gave an animal (farm.names), else its species' name. */
export function animalName(state, id) {
  const n = state?.farm?.names?.[id]?.name;
  if (typeof n === 'string' && n) return n;
  const o = objectOf(state, id);
  return (o && animalOf(o.def)?.name) || 'the animal';
}

/** "Daisy and Clover", "Daisy and a Cow", "Two Cows" (pure): the pair as the toast says it. */
export function pairWords(state, a, b) {
  const named = (id) => typeof state?.farm?.names?.[id]?.name === 'string';
  const sp = animalName({ farm: { objects: state.farm.objects } }, a);
  if (named(a) && named(b)) return `${animalName(state, a)} and ${animalName(state, b)}`;
  if (named(a) || named(b)) return `${animalName(state, named(a) ? a : b)} and ${/^[aeiou]/i.test(sp) ? 'an' : 'a'} ${sp}`;
  return `Two ${plural(sp)}`;
}

const plural = (s) => (/[^aeiou]y$/i.test(s) ? `${s.slice(0, -1)}ies` : /(s|sh|ch|x)$/i.test(s) ? `${s}es` : /sheep$/i.test(s) ? s : `${s}s`);

export function createPairing({ store, view, toast = () => {}, perform }) {
  const listeners = new Set();
  let active = false;
  let first = null;
  let species = null;

  const now = () => store.now();
  const candidates = () => {
    if (!active || !store.state) return [];
    if (first) return partnersFor(store.state, first, now());
    return Object.keys(store.state.farm.objects).sort().filter((id) => pairable(store.state, id, now()) === null
      && (!species || store.state.farm.objects[id].def === species));
  };
  function text() {
    if (!active) return '';
    const sp = species ? animalOf(species)?.name ?? 'animal' : null;
    if (!first) return sp ? `Pick two adult ${plural(sp)} to pair` : 'Pick two adults of one kind to pair';
    const named = typeof store.state?.farm?.names?.[first]?.name === 'string';
    const one = named ? `${animalName(store.state, first)} it is.` : `One ${sp ?? 'animal'} picked.`;
    return `${one} Now pick another adult ${sp ?? 'of the same kind'}`;
  }
  /** Highlight the homes of the animals a click could pick now (render-world's tile highlight). */
  function glow() {
    if (!active || !store.state) { view.highlight?.([], null); return; }
    const homes = new Set(candidates().map((id) => store.state.farm.objects[id].home));
    const tiles = [];
    for (const h of homes) {
      const o = objectOf(store.state, h);
      const def = o ? defOf(o.def) : null;
      if (!o || !def || !Number.isFinite(o.x)) continue;
      const [w, d] = def.size ? footprint(def, o.rot ?? 0) : [1, 1];
      for (let dz = 0; dz < d; dz++) for (let dx = 0; dx < w; dx++) tiles.push([o.x + dx, o.z + dz]);
    }
    view.highlight?.(tiles, tiles.length ? '#FF9EB5' : null);
  }
  function emit() {
    glow();
    const p = { active, first, species, candidates: candidates(), text: text() };
    for (const fn of [...listeners]) { try { fn(p); } catch (err) { console.error('pairing listener failed', err); } }
  }

  /** Enter the mode (optionally with the first animal picked, or only one species allowed). */
  function start(firstId = null, sp = null) {
    if (!store.ready) return false;
    active = true;
    first = null;
    species = sp && animalOf(sp) ? sp : null;
    if (firstId && pairable(store.state, firstId, now()) === null) {
      first = firstId;
      species = store.state.farm.objects[firstId].def;
      view.fx?.play?.({ e: 'heartSpark', id: firstId });
    }
    emit();
    return true;
  }

  function cancel() {
    if (!active) return;
    active = false;
    first = null;
    species = null;
    emit();
  }

  /** The eligible adult a click on `id` means: the animal itself, or a home's first adult not picked yet. */
  function resolveTarget(id) {
    const o = objectOf(store.state, id);
    if (!o) return null;
    if (animalOf(o.def)) return id;
    const inside = occupantsOf(store.state, id).filter((a) => a !== first && pairable(store.state, a, now()) === null
      && (!species || store.state.farm.objects[a].def === species));
    return inside[0] ?? null;
  }

  function pick(id) {
    if (!active || !store.ready) return { ok: false, code: ERR.NOT_FOUND };
    const target = resolveTarget(id);
    const why = target ? pairable(store.state, target, now()) : ERR.NOT_FOUND;
    if (why) {
      toast(why === ERR.NOT_READY ? 'Only grown-ups can be paired: babies grow up first.'
        : why === ERR.BAD_ARGS ? 'Bees live in colonies: they never pair.' : 'Pick an adult animal.', {});
      return { ok: false, code: why };
    }
    const sp = store.state.farm.objects[target].def;
    if (!first) {
      if (species && sp !== species) { toast(`Pick an adult ${animalOf(species)?.name ?? 'animal'}.`, {}); return { ok: false, code: ERR.BAD_ARGS }; }
      first = target;
      species = sp;
      view.fx?.play?.({ e: 'heartSpark', id: target });
      emit();
      return { ok: true, done: false };
    }
    if (target === first) { first = null; emit(); return { ok: true, done: false }; }        // a second click undoes it
    if (sp !== species) {
      toast(`${animalName(store.state, first)} pairs with another ${animalOf(species)?.name ?? 'of its kind'}.`, {});
      return { ok: false, code: ERR.BAD_ARGS };
    }
    const args = { a: first, b: target };
    const code = dryRun(store, 'breed', args);
    if (code) {
      toast(code === ERR.OCCUPIED ? 'The Breeding Barn has a pair in it already: one at a time.'
        : code === ERR.CAP ? `No home has room for a baby ${animalOf(species)?.name ?? 'animal'}: upgrade or build one first.`
          : code === ERR.UNKNOWN_ACTION || code === ERR.LOCKED ? 'The Breeding Barn opens at level 28.' : code, {});
      return { ok: false, code };
    }
    const res = perform('breed', args);
    if (!res || !res.ok) return { ok: false, code: res?.code ?? ERR.INTERNAL };
    view.fx?.play?.({ e: 'heartSpark', id: target });
    const names = pairWords(store.state, first, target);
    active = false;
    first = null;
    species = null;
    emit();
    toast(`${names} are in the Breeding Barn. A baby is on its way!`, { kind: 'ok' });
    return { ok: true, done: true };
  }

  store.on?.('change', () => { if (active) emit(); });

  return {
    start,
    pick,
    cancel,
    get active() { return active; },
    get first() { return first; },
    get species() { return species; },
    get candidates() { return candidates(); },
    get text() { return text(); },
    /** Re-lay the homes' glow (the controller clears highlights on hover changes while the mode runs). */
    refresh: glow,
    on(name, fn) { if (name !== 'pair') return () => {}; listeners.add(fn); return () => listeners.delete(fn); },
  };
}
