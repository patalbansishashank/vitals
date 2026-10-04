/**
 * Kitchen catalogues (R12; SUITE_SPEC §13.3), pure: types, the indexed catalogue and its validation, regional defaults,
 * one search index with alias matching (Hindi and regional names), the free-text resolver and paste-a-list parser,
 * food-reference resolution, the kitchen/pantry document edits and the Coach's kitchen block and recipe constraints.
 * The data is `@/content/catalogues/kitchen` (generated from the R12 seed; load it with `loadKitchen()` from
 * `@/content/catalogues/kitchenCatalogue`).
 */
export * from './types';
export { createKitchenCatalogue, validateKitchenSeed, groupLabel, GROUP_LABEL, type KitchenCatalogue, type KitchenGroup } from './catalogue';
export { buildKitchenIndex, searchKitchen, filterIds, namesOf, SHOW_AT, ACCEPT_AT, type KitchenIndex, type KitchenHit } from './search';
export { parseKitchenList, resolveFreeText, splitList, cleanLine, customId, isCustomId } from './parse';
export { regionDefaults, chooseRegions, orderForRegion, WESTERN_GENERIC, type RegionDefaults } from './regions';
export { resolveFood, foodRefOf, foodKey, type FoodResolution } from './food';
export {
  EMPTY_KITCHEN,
  EMPTY_PANTRY,
  STALE_DAYS,
  NOTE_MAX,
  LEGACY_IDS,
  toKitchenDoc,
  toPantryDoc,
  setKitchenLists,
  addEquipment,
  addPantry,
  removePantry,
  setPantry,
  staleItems,
  entryId,
  isKitchenId,
  migrateFromIntake,
  type EquipmentInput,
  type PantryInput,
} from './docs';
export { recipeConstraints, recipeConstraintsFromViews, kitchenBriefingBlock, kitchenBlockFromViews, type KitchenBlockInput, type PantryBlockInput, labelOf, BRIEFING_PANTRY_MAX, KITCHEN_BLOCK_MAX_CHARS, type RecipeConstraints } from './coach';
