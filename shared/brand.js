// The game's name, one place for the rules and the client. A brand: Latin letters in every language (the Bulgarian
// glossary). The game was called "Harvest Hollow" until 2026-10-13 (and briefly "Harvest Harness" that day, never
// deployed); saves are never rewritten, so a farm its farmers never named still carries an old default name, and every
// screen shows such a farm under the new one.
//
//   BRAND                 'Harness Hollow'
//   DEFAULT_FARM_NAMES    what createFarm called a new farm, then and now
//   farmName(state)       the name to show for a farm: its farmers' name, else the brand; null without a farm
//   ownFarmName(state)    the farmers' own name, or null while the farm carries a default name
// Pure (shared/ rule): no clock, no DOM.

export const BRAND = 'Harness Hollow'; // i18n-ok: the brand
export const DEFAULT_FARM_NAMES = Object.freeze([BRAND, 'Harvest Hollow', 'Harvest Harness']); // i18n-ok: the brand, new and old

/** The farmers' own name for the farm, or null while it carries a default name nobody chose (`farm.coop.named`). */
export function ownFarmName(state) {
  const own = typeof state?.farm?.name === 'string' ? state.farm.name.trim() : '';
  if (!own) return null;
  if (DEFAULT_FARM_NAMES.includes(own) && !state.farm.coop?.named) return null;
  return own;
}

/** The name to show for a farm: its own, else the brand (a farm made before the rename included). */
export function farmName(state) {
  if (!state?.farm) return null;
  return ownFarmName(state) ?? BRAND;
}
