/**
 * Kitchen catalogues (R12; SUITE_SPEC §13.3): equipment, cuisines, staples and pantry items with regional defaults, and
 * the two documents the picker, Settings › Kitchen, the Food tab and the Coach all write (`kitchen/me`, `pantry/me`).
 * Pure types. Ids are namespaced so the four lists share one search index: `eq.*`, `cu.*`, `st.*`, `pa.*`; items the
 * person adds that match nothing are `custom:<slug>`.
 */

export type KitchenKind = 'equipment' | 'cuisines' | 'staples' | 'pantry';
export const KITCHEN_KINDS: readonly KitchenKind[] = ['equipment', 'cuisines', 'staples', 'pantry'];
/** Id prefix per kind. */
export const KIND_PREFIX: Readonly<Record<KitchenKind, string>> = { equipment: 'eq.', cuisines: 'cu.', staples: 'st.', pantry: 'pa.' };

/** Link from a staple or pantry item to the food reference (R12 §7). */
export interface SeedFoodRef {
  /** A food of the 12-item test fixture (never shown to people). */
  fixtureId?: string;
  /** USDA FoodData Central SR Legacy id. */
  usdaFdcId?: number;
  usdaDescription?: string;
  /** The best source is IFCT 2017 (not licensed yet); a USDA id, when present, is only a proxy. */
  ifctPending?: boolean;
}

interface SeedBase {
  id: string;
  label: string;
  group: string;
  aliases: readonly string[];
}

export interface SeedEquipment extends SeedBase {
  subgroup: string;
  regionDefault: readonly string[];
  /** Placeholder for the per-item note ("size in litres, e.g. 28 L"). */
  notesHint?: string;
}
export interface SeedCuisine extends SeedBase {
  /** Parent cuisine (`cu.chettinad` → `cu.tamil`). */
  parent?: string;
  regions: readonly string[];
}
export interface SeedStaple extends SeedBase {
  subgroup: string;
  regionDefault: readonly string[];
  foodRef?: SeedFoodRef;
}
export interface SeedPantry extends SeedBase {
  subgroup: string;
  regionDefault: readonly string[];
  /** The Coach may ask "still have it?" for perishables; nothing expires automatically. */
  perishable: boolean;
  foodRef?: SeedFoodRef;
}
export interface SeedRegion {
  id: string;
  label: string;
  country: string;
  /** "Common here": shown first in each group, not ticked. */
  defaults: Readonly<Record<KitchenKind, readonly string[]>>;
  /** The short list that is ticked on first view. */
  preTick: Readonly<Partial<Record<KitchenKind, readonly string[]>>>;
}

export interface KitchenSeed {
  version: number;
  generated: string;
  notes: string;
  equipment: readonly SeedEquipment[];
  cuisines: readonly SeedCuisine[];
  staples: readonly SeedStaple[];
  pantry: readonly SeedPantry[];
  regions: readonly SeedRegion[];
}

export type KitchenItem = SeedEquipment | SeedCuisine | SeedStaple | SeedPantry;

/* --------------------------------------------------------------------------------------------- documents */

export type KitchenSource = 'picker' | 'coach' | 'paste';
export type EquipmentUse = 'use' | 'ownNotUsed';

export interface KitchenEquipmentEntry {
  /** Catalogue id or `custom:<slug>`. */
  id: string;
  /** The person's words (custom items, or a label they typed). */
  label?: string;
  /** "small OTG, 28 L" (≤ 80 characters). */
  note?: string;
  use: EquipmentUse;
  addedAt: string;
  source: KitchenSource;
}
export interface KitchenCuisineEntry {
  id: string;
  /** 1 = most often. */
  rank: number;
  label?: string;
}
export interface KitchenStapleEntry {
  id: string;
  source: KitchenSource;
  label?: string;
}

/** `vitals.kitchen/1`: collection `kitchen`, key `me`, LWW-F. */
export interface KitchenDoc {
  _schema: 1;
  equipment: KitchenEquipmentEntry[];
  cuisines: KitchenCuisineEntry[];
  staples: KitchenStapleEntry[];
  /**
   * Regions whose defaults the person started from (first = main). Additive to SUITE_SPEC §13.3: the picker's
   * "Use another region" choice has to persist somewhere, and it never changes the lists by itself.
   */
  regions?: string[];
}

export interface PantryEntry {
  /** Pantry or staple id (resolves to a food) or `custom:<slug>`. */
  id: string;
  label?: string;
  /** "about 1 kg", as written; never parsed into grams. */
  qtyApprox?: string;
  source: KitchenSource;
  addedAt: string;
  lastConfirmedAt?: string;
}
/** `vitals.pantry/1`: collection `pantry`, key `me`, LWW-F. */
export interface PantryDoc {
  _schema: 1;
  items: PantryEntry[];
}

/** One parsed line of free text ("I also have…", paste-a-list). */
export interface ParsedItem {
  /** The words as written, quantities removed. */
  label: string;
  /** Catalogue id, or null when nothing matched well enough (kept as the person's own item). */
  id: string | null;
  /** 0..1 (1 = exact name or alias). */
  confidence: number;
  /** Quantity text stripped from the line ("2 kg"), kept for `qtyApprox`. */
  qty?: string;
}
