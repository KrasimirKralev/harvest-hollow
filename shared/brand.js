// Old default names are displayed under the new brand. Retain names explicitly chosen by the farmers.
export const BRAND = 'MNKISWAN Tree Village'; // i18n-ok: the brand
export const DEFAULT_FARM_NAMES = Object.freeze([BRAND, 'MNKISWAN Meadow Picnic', 'Harness Hollow', 'Harvest Hollow', 'Harvest Harness']); // i18n-ok: the brand, new and old

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
