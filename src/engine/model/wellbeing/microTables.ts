/**
 * Micronutrient rule table data (dossier 15 §4.9, grade D). Pure data: `params.ts` turns every number into a ParamDef
 * and `micronutrients.ts` evaluates the rule table from those parameter values.
 *
 * D8-08: this table is an archived PATTERN heuristic (typical density × energy), never actual intake, deficiency or status.
 * Actual known amounts come from the shared exposure ledger (`DayInput.exposure`, C3) for `TRACKED_NUTRIENTS`, and their
 * interpretation uses the typed DRI references of `./dri.ts` (EAR/RDA/AI/UL, life stage, form and scope).
 *
 * Nutrient set = those with a typical-density row in the 15 §4.9 table (potassium and iodine have pattern multipliers
 * but no density row and therefore cannot be projected; fibre is evaluated from the schedule's own fibre grams).
 * Densities are per 1000 kcal (A TO Z baseline women, 1 935 kcal); EARs are NASEM values for women 31-50 and men
 * (vitamin K uses the AI); non-menstruating women (post-menopause, or a stated "not menstruating") use the men's iron EAR
 * in the heuristic (15 §4.9: RDA 8 mg men / post-menopausal); menstruation is never inferred from sex or age alone.
 */
import type { ExposureId } from '@/lib/bodyContracts';

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
  /**
   * Legacy multivitamin class of 15 §4.9 (vitamins 100 % RDA, Mg/Ca a share). D8-08: kept as documentation only; a
   * multivitamin of unknown composition supplies NO dose in the heuristic (product actives come from the ledger, C3).
   */
  readonly mvm: 'vitamin' | 'mineral' | 'none';
  /** Exposure identity of the shared ledger (C3) carrying actual known amounts of this nutrient, when one exists. */
  readonly exposureId?: ExposureId;
}

/** Order defines the index used by the flag array (indices 0..11). */
export const MICRO_NUTRIENTS: readonly MicroNutrient[] = [
  { key: 'mg', unit: 'mg', density: 154, earF: 265, earM: 350, q1: 0.8, q3: 1.35, mvm: 'mineral', exposureId: 'magnesium' },
  { key: 'ca', unit: 'mg', density: 444, earF: 800, earM: 800, q1: 1, q3: 1.2, mvm: 'mineral', exposureId: 'calcium' },
  { key: 'vitA', unit: 'µg RAE', density: 352, earF: 500, earM: 625, q1: 0.8, q3: 1.35, mvm: 'vitamin', exposureId: 'vitARae' },
  { key: 'zn', unit: 'mg', density: 5.3, earF: 6.8, earM: 9.4, q1: 1, q3: 1.2, mvm: 'none', exposureId: 'zinc' },
  { key: 'vitC', unit: 'mg', density: 50, earF: 60, earM: 75, q1: 0.8, q3: 1.35, mvm: 'vitamin', exposureId: 'vitC' },
  { key: 'folate', unit: 'µg DFE', density: 275, earF: 320, earM: 320, q1: 0.8, q3: 1.35, mvm: 'vitamin', exposureId: 'folateDfe' },
  { key: 'thiamin', unit: 'mg', density: 0.83, earF: 0.9, earM: 1.0, q1: 1, q3: 1, mvm: 'vitamin' },
  { key: 'iron', unit: 'mg', density: 7.7, earF: 8.1, earM: 6, q1: 1, q3: 1, mvm: 'none', exposureId: 'iron' },
  { key: 'b12', unit: 'µg', density: 2.6, earF: 2.0, earM: 2.0, q1: 1, q3: 1, mvm: 'vitamin', exposureId: 'b12' },
  { key: 'vitK', unit: 'µg (AI)', density: 64, earF: 90, earM: 120, q1: 0.8, q3: 1.35, isAi: true, mvm: 'vitamin' },
  { key: 'vitE', unit: 'mg', density: 4.7, earF: 12, earM: 12, q1: 1, q3: 1.5, mvm: 'vitamin' },
  { key: 'vitD', unit: 'µg', density: 2.2, earF: 10, earM: 10, q1: 1, q3: 1.5, mvm: 'vitamin', exposureId: 'vitD' },
];

/**
 * Exposure identities of the shared ledger (C3, canonical units of `EXPOSURE_UNITS`) whose KNOWN daily amounts the module
 * tracks with their coverage (D8-08). Order defines the nutrient-major layout of the state rings.
 */
export const TRACKED_NUTRIENTS = [
  'calcium',
  'magnesium',
  'iron',
  'zinc',
  'iodine',
  'vitD',
  'b12',
  'folateDfe',
  'vitARae',
  'vitC',
  'ala',
  'linoleic',
] as const satisfies readonly ExposureId[];
export type TrackedNutrient = (typeof TRACKED_NUTRIENTS)[number];
export const N_TRACKED = TRACKED_NUTRIENTS.length;
export const TRACKED_IDX: Readonly<Record<TrackedNutrient, number>> = Object.fromEntries(TRACKED_NUTRIENTS.map((id, i) => [id, i])) as Record<TrackedNutrient, number>;

/**
 * Coverage code of one tracked nutrient on one day (state `nutCovRing`): nothing known; partial (the amount is a known
 * lower bound); complete; confirmed zero; an as-planned estimate (not observed); a prescribed/planned day (scenario input).
 */
export const NUT_COV = { unknown: 0, partial: 1, complete: 2, confirmedZero: 3, asPlanned: 4, planned: 5 } as const;

export const N_MICRO = MICRO_NUTRIENTS.length;

/** Indices of the nutrients the rest of the module needs by name. */
export const MICRO_IDX = { mg: 0, ca: 1, vitA: 2, zn: 3, vitC: 4, folate: 5, thiamin: 6, iron: 7, b12: 8, vitK: 9, vitE: 10, vitD: 11 } as const;

/**
 * Tracked-exposure slot (`TRACKED_IDX`) of each pattern nutrient (`MICRO_NUTRIENTS` order), −1 when the ledger has no
 * identity for it (thiamin, vitamin K, vitamin E): where a known logged amount exists it takes precedence over the pattern
 * prior (D8-08).
 */
export const MICRO_TRACKED: Int8Array = Int8Array.from(
  MICRO_NUTRIENTS.map((n) => (n.exposureId !== undefined && n.exposureId in TRACKED_IDX ? TRACKED_IDX[n.exposureId as TrackedNutrient] : -1)),
);

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
