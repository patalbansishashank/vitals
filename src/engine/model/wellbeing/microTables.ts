/**
 * Micronutrient rule table data (dossier 15 §4.9, grade D). Pure data: `params.ts` turns every number into a ParamDef
 * and `micronutrients.ts` evaluates the rule table from those parameter values.
 *
 * Nutrient set = those with a typical-density row in the 15 §4.9 table (potassium and iodine have pattern multipliers
 * but no density row and therefore cannot be projected; fibre is evaluated from the schedule's own fibre grams).
 * Densities are per 1000 kcal (A TO Z baseline women, 1 935 kcal); EARs are NASEM values for women 31-50 and men
 * (vitamin K uses the AI); post-menopausal women use the men's iron EAR (15 §4.9: RDA 8 mg men / post-menopausal).
 */

export interface MicroNutrient {
  /** Parameter-id key, also the index label. */
  readonly key: string;
  readonly unit: string;
  /** Typical density per 1000 kcal at food quality 2 (15 §4.9 table). */
  readonly density: number;
  readonly earF: number;
  readonly earM: number;
  /** Food-quality multipliers (15 §4.9 QMULT): quality 1 and quality 3 (quality 2 = 1). */
  readonly q1: number;
  readonly q3: number;
  readonly isAi?: boolean;
  /** True for vitamins (multivitamin adds 100 % of the RDA), false for Mg/Ca (share of RDA) or minerals not covered. */
  readonly mvm: 'vitamin' | 'mineral' | 'none';
}

/** Order defines the index used by the flag array (indices 0..11). */
export const MICRO_NUTRIENTS: readonly MicroNutrient[] = [
  { key: 'mg', unit: 'mg', density: 154, earF: 265, earM: 350, q1: 0.8, q3: 1.35, mvm: 'mineral' },
  { key: 'ca', unit: 'mg', density: 444, earF: 800, earM: 800, q1: 1, q3: 1.2, mvm: 'mineral' },
  { key: 'vitA', unit: 'µg RAE', density: 352, earF: 500, earM: 625, q1: 0.8, q3: 1.35, mvm: 'vitamin' },
  { key: 'zn', unit: 'mg', density: 5.3, earF: 6.8, earM: 9.4, q1: 1, q3: 1.2, mvm: 'none' },
  { key: 'vitC', unit: 'mg', density: 50, earF: 60, earM: 75, q1: 0.8, q3: 1.35, mvm: 'vitamin' },
  { key: 'folate', unit: 'µg DFE', density: 275, earF: 320, earM: 320, q1: 0.8, q3: 1.35, mvm: 'vitamin' },
  { key: 'thiamin', unit: 'mg', density: 0.83, earF: 0.9, earM: 1.0, q1: 1, q3: 1, mvm: 'vitamin' },
  { key: 'iron', unit: 'mg', density: 7.7, earF: 8.1, earM: 6, q1: 1, q3: 1, mvm: 'none' },
  { key: 'b12', unit: 'µg', density: 2.6, earF: 2.0, earM: 2.0, q1: 1, q3: 1, mvm: 'vitamin' },
  { key: 'vitK', unit: 'µg (AI)', density: 64, earF: 90, earM: 120, q1: 0.8, q3: 1.35, isAi: true, mvm: 'vitamin' },
  { key: 'vitE', unit: 'mg', density: 4.7, earF: 12, earM: 12, q1: 1, q3: 1.5, mvm: 'vitamin' },
  { key: 'vitD', unit: 'µg', density: 2.2, earF: 10, earM: 10, q1: 1, q3: 1.5, mvm: 'vitamin' },
];

export const N_MICRO = MICRO_NUTRIENTS.length;

/** Indices of the nutrients the rest of the module needs by name. */
export const MICRO_IDX = { mg: 0, ca: 1, vitA: 2, zn: 3, vitC: 4, folate: 5, thiamin: 6, iron: 7, b12: 8, vitK: 9, vitE: 10, vitD: 11 } as const;

/** Flag slots after the 12 nutrient flags. */
export const FLAG_FIBRE = 12;
export const FLAG_EFA = 13;
export const FLAG_FAT_SOL = 14;
export const FLAG_IODINE = 15;
export const N_FLAGS = 16;

export interface MicroPatternRow {
  readonly key: 'lowCarb' | 'vegan' | 'vegetarian';
  readonly label: string;
  readonly anchor: string;
  /** Multipliers on the typical density, by nutrient key (absent = 1). */
  readonly mult: Readonly<Record<string, number>>;
}

/** 15 §4.9 "Pattern modifiers on density" (±30 % uncertainty, grade D). */
export const MICRO_PATTERN_ROWS: readonly MicroPatternRow[] = [
  {
    key: 'lowCarb',
    label: 'carbohydrate < 100 g/d or < 25 %E at food quality 1-2',
    anchor: 'systematic review of 10 low-carbohydrate studies (15 §4.9 ref 80); A TO Z Atkins arm (Gardner 2010 PMID 20573800)',
    mult: { vitC: 0.6, folate: 0.65, thiamin: 0.75, mg: 0.8, iron: 0.9, ca: 0.9 },
  },
  {
    key: 'vegan',
    label: 'animal foods excluded (vegan)',
    anchor: 'vegan micronutrient reviews (15 §4.9 refs 81-83)',
    mult: { b12: 0.1, ca: 0.75, zn: 0.8, vitD: 0.8 },
  },
  {
    key: 'vegetarian',
    label: 'vegetarian (dairy/egg)',
    anchor: 'vegetarian micronutrient reviews (15 §4.9 refs 81, 83)',
    mult: { b12: 0.5, zn: 0.85 },
  },
];
