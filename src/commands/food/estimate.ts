/**
 * Meal estimates: components with grams → nutrients from the food table (or a transcribed label / the person's numbers)
 * with uncertainty bands. The model never states nutrient numbers; this is the only place meal nutrients are computed
 * (R4 decision 1, SUITE_SPEC §5 photo pipeline, R8 §6.3).
 *
 * Bands: per component σ² = (per-gram nutrient · σ_g)² + (value · 10 % table error)², σ_g = (gramsHigh − gramsLow)/3.3;
 * the meal's σ is the root sum of squares, floored by the source's display band (R8 §6.3, ± ≈ 1 SD shown as a range):
 * photo only ±35/40/50/55 % (energy/carbohydrate/protein/fat), photo + text ±20/25/30/30, user grams ±15/15/20/25,
 * household units ±20/20/25/30, weighed or label ±8/8/10/10, free text without amounts ±30/30/35/45; gravies, curries,
 * fried and restaurant food ×1.3 on energy and fat, ×1.15 on the rest. The floors are UNCALIBRATED display assumptions
 * (`FOOD_BAND_SEMANTICS`: a heuristic band, not a validated SD and not P10/P90 coverage, D6-06). The band follows the
 * amount method when one is given (weighed, label serving, household, photo); numeric grams alone never mean weighed.
 *
 * Unknown is not zero (C3/D6-02/D6-03): a field a source does not give stays unknown through the component, the meal totals
 * (`unknown`, with a 0 placeholder for legacy readers and the known partial sum in `lowerBounds`) and the log entry; energy
 * is always known (reported, or the convention energy of a label that gives every macro). Every other nutrient a source
 * carries (sodium, saturated fat, sugars, calcium, vitamins…) travels in the frozen per-100 g snapshot and the meal's
 * nutrient ledger (`MealEstimate.nutrients`), each with its own completeness.
 *
 * Carbohydrate (D6-01): `netCarbG` is AVAILABLE carbohydrate, normalised once from the source's declared basis; the
 * reported value stays in the snapshot (`carbG`). Unknown basis or a needed fibre that is missing leaves it unknown. A new
 * label without a declared basis has an UNKNOWN basis (A1-024); the legacy total-by-difference reading is only the
 * explicit adapter of stored pre-change entries (`legacyTotalByDifference`).
 * Energy (D6-08, A1-028/A1-030): one shared resolver (`sourceEnergyOf`) chooses a form-specific measured ME once, only for
 * the as-eaten form it was measured on; the choice is frozen on the logged component (`energySource`).
 * Recipes (D6-04): batch_n = Σ(edible_i/100 × source_n_i × retention_n_i) + added_n − discarded_n; a cooked-gram density
 * only from a measured, sourced or complete mass-balance final edible mass; otherwise servings are fractions of the batch.
 * A removal not stated per nutrient is unknown for every nutrient its material can carry (A1-042); ingredient state is the
 * state of the measured mass and must match its source record (A1-043); additions enter the mass balance only with their
 * own material mass (A1-044).
 */
import { asEatenFormOf, availableCarbOf, FOOD_BAND_SEMANTICS, FOOD_NUTRIENT_KEYS, polyolsOf as recordPolyolsG, sourceEnergyOf, stateOfText, type AsEatenForm, type SourceEnergy } from '@/catalogues/foods';
import type { FoodRecord, FoodTable, MealTotals, NutrientKey } from '@/catalogues/types';
import type { AmountMethod, Est, MealComponent, NutrientEstimate } from '@/living';
import { availableCarbohydrate, ingredientEdibleMassG, per100FromBatch, recipeBatchNutrient, type CarbohydrateBasis, type ExposureId } from '@/lib/bodyContracts';
import { aggregateSnapshots, POLYOL_IDENTITY_KEY_PREFIX, polyolIdentityKey, UPPER_BOUND_KEY_PREFIX, type NutrientAggregate } from '@/lib/nutrientExposure';
import type { AmountKind } from './parse';

export type BandKind = 'photoOnly' | 'photoText' | 'userGrams' | 'household' | 'weighed' | 'text';
type Macro = 'energy' | 'carb' | 'protein' | 'fat';

export const BAND_FLOORS: Readonly<Record<BandKind, Readonly<Record<Macro, number>>>> = {
  photoOnly: { energy: 0.35, carb: 0.4, protein: 0.5, fat: 0.55 },
  photoText: { energy: 0.2, carb: 0.25, protein: 0.3, fat: 0.3 },
  userGrams: { energy: 0.15, carb: 0.15, protein: 0.2, fat: 0.25 },
  household: { energy: 0.2, carb: 0.2, protein: 0.25, fat: 0.3 },
  weighed: { energy: 0.08, carb: 0.08, protein: 0.1, fat: 0.1 },
  text: { energy: 0.3, carb: 0.3, protein: 0.35, fat: 0.45 },
};
/** What these bands are (D6-06): uncalibrated display defaults, versioned. */
export const BAND_SEMANTICS = FOOD_BAND_SEMANTICS;
const TABLE_ERROR = 0.1;
const FATTY = /fried|fry|curry|gravy|restaurant|takeaway|tadka|deep/i;

/** Display band of an explicit amount method (D6-06); null = decide from how the amount was given. */
export function bandOfAmountMethod(m: AmountMethod | undefined): BandKind | null {
  switch (m) {
    case 'weighed':
    case 'labelServing':
      return 'weighed';
    case 'household':
      return 'household';
    case 'photoEstimated':
      return 'photoOnly';
    case 'userEstimated':
      return 'userGrams';
    default:
      return null;
  }
}

/**
 * Per-100 g values the arithmetic uses (net = available carbohydrate). Fields listed in `unknown` are not given by the
 * source (their number is a 0 placeholder and never enters a sum as a measured zero).
 */
export type Per100 = MealTotals & {
  unknown?: ReadonlyArray<keyof MealTotals>;
  /** Ethanol, g, when the source lists it (table/recipe records list it only when present: absent = none, C3). */
  alcoholG?: number;
  /** Caffeine, mg, when the source lists it (absent = not analysed, never zero). */
  caffeineMg?: number;
  /**
   * (D6-03) Every other per-100 g nutrient the source gives, by catalogue key (`carbG` = the REPORTED carbohydrate on the
   * source's basis; `polyolsG` = Σ identified polyols); null = given as unknown. A key absent here is not analysed.
   */
  extra?: Readonly<Record<string, number | null>>;
  /** (D6-01) carbohydrate normalisation of `netCarbG`: resolved, unresolved (unknown), or legacy-assumed arithmetic. */
  carbStatus?: 'resolved' | 'unresolved' | 'legacyAssumed';
  /** (D6-08) `energyKcal` is the food/form-specific measured ME (an alternative to the source energy, never stacked). */
  energyBasis?: 'source' | 'measuredME';
  /** (D6-08) the source's own energy per 100 g when `energyKcal` is a measured ME (kept for audit, never added). */
  sourceEnergyKcal?: number;
  /**
   * (D6-03/D6-05) snapshot keys whose value the source IMPUTED (e.g. FDC "assumed zero" or borrowed values), not analysed:
   * they count in sums but stay marked imputed on the logged exposure.
   */
  imputed?: readonly string[];
  /** (D6-08, A1-030) how a table food's energy was chosen for its as-eaten form (frozen on the logged component). */
  energySource?: SourceEnergy;
  /** (A1-042) per-100 g upper bounds of values that are unknown because a removal is unknown (never lower bounds). */
  upper?: Readonly<Record<string, number>>;
};

/** A component ready to compute: grams plus where its per-100 g values come from. */
export interface ResolvedComponent {
  name: string;
  localName?: string;
  foodId?: string;
  recipeId?: string;
  grams: number;
  gramsLow: number;
  gramsHigh: number;
  portion?: { unit: string; count: number };
  amount: AmountKind | 'label';
  cookingMethod?: string;
  visibleFatCue?: 'none' | 'some' | 'glossy' | 'pooled';
  /** Per-100 g values when known (table food, recipe, label); absent = unresolved. */
  per100?: Per100;
  nutrientSource?: MealComponent['nutrientSource'];
  /** Identification confidence 0–1 (name match × model confidence). */
  idConfidence: number;
  band: BandKind;
  /** (D6-01) carbohydrate basis the source declared (absent = legacy arithmetic). */
  carbBasis?: CarbohydrateBasis;
  /** (D6-06) how the amount was obtained, as given (numbers alone never mean weighed). */
  amountMethod?: AmountMethod;
  /** (C1/C3) frozen per-100 g composition and its source version (null = not given by the source). */
  snapshot?: MealComponent['snapshot'];
  /** (D6-04) a recipe serving logged as a fraction of its batch (grams then refer to `massBasis`). */
  recipeServing?: RecipeServingSnapshot;
  /** (D6-06) other table records that matched almost as well (an identity-ambiguity candidate set, no probabilities). */
  identityCandidates?: readonly string[];
  /** (D6-06) additional shared-error groups of this component (e.g. a recipe's retained oil). */
  groupIds?: readonly string[];
}

/** A value with its band (± ≈ 1 SD of the heuristic display band). */
export interface Banded {
  value: number;
  sd: number;
  low: number;
  high: number;
}
export interface BandedTotals {
  energyKcal: Banded;
  proteinG: Banded;
  /** Net (available) carbohydrate, g. */
  carbG: Banded;
  fatG: Banded;
  fibreG: Banded;
  /** Fields that are UNKNOWN (some component's source does not give them): their band is a 0 placeholder. */
  unknown?: ReadonlyArray<BandedKey>;
  /** Ethanol, g, when a component contains it (counted once: its energy is inside `energyKcal`). */
  alcoholG?: Banded;
  /** (D6-03) saturated fat, sugars, sodium: present only when every resolved component gives them. */
  satFatG?: Banded;
  sugarsG?: Banded;
  sodiumMg?: Banded;
}
export type BandedKey = 'energyKcal' | 'proteinG' | 'carbG' | 'fatG' | 'fibreG';

export interface MealEstimate {
  components: Array<ResolvedComponent & { nutrients?: BandedTotals; confidence: number }>;
  totals: BandedTotals;
  /** Energy-weighted identification × amount confidence, 0–1. */
  confidence: number;
  /** Indices of components below 0.7 confidence. */
  lowConfidence: number[];
  /** Indices of components without nutrient values (no food match, no label). */
  unresolved: number[];
  /** Known partial sums of the unknown fields (lower bounds: the unknown part is ≥ 0). */
  lowerBounds?: Partial<Record<BandedKey, number>>;
  /** Caffeine of the meal when a component's source lists it, mg; `complete` false = other components not analysed. */
  caffeineMg?: { knownSum: number; complete: boolean };
  /** (D6-03) the meal's nutrient ledger: every nutrient any component's source carries, with nutrient-specific coverage. */
  nutrients?: Partial<Record<ExposureId, NutrientAggregate>>;
  /** (D6-06) what the bands mean. */
  band?: typeof BAND_SEMANTICS;
}

const AMOUNT_CONF: Readonly<Record<ResolvedComponent['amount'], number>> = { weighed: 1, label: 1, household: 0.9, count: 0.9, default: 0.7 };
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Nutrient keys carried in `Per100.extra` (everything except the MealTotals macros, ethanol and caffeine). */
const EXTRA_KEYS: readonly NutrientKey[] = FOOD_NUTRIENT_KEYS.filter((k) => !['energyKcal', 'proteinG', 'fatG', 'fibreG', 'satFatG', 'alcoholG', 'caffeineMg'].includes(k));

/**
 * Energy per 100 g a record contributes (D6-08): the shared resolver's choice (`sourceEnergyOf`): a form-specific measured
 * ME only for the as-eaten form it was measured on, else the source energy. Without a form, the record's own form.
 */
export function energyOfFood(f: Pick<FoodRecord, 'per100g' | 'measuredME'>, asEaten?: AsEatenForm | null): { kcal: number; basis: 'source' | 'measuredME' } {
  const e = sourceEnergyOf(f, asEaten);
  return { kcal: e.kcal, basis: e.basis };
}

/**
 * Per-100 g values of a table food (available carbohydrate on its basis; every other nutrient it gives in `extra`;
 * identified polyols by identity as `polyolG:<name>` beside their total). `asEaten` is the as-eaten form (portion label,
 * cooking/preparation words): it decides whether a form-specific measured ME applies (A1-030).
 */
export function per100OfFood(foodId: string, table: FoodTable, asEaten?: AsEatenForm | null): Per100 | undefined {
  const f = table.get(foodId);
  if (!f) return undefined;
  const n = f.per100g;
  const carb = availableCarbOf(f);
  const unknown: Array<keyof MealTotals> = [];
  if (carb.availableG === null) unknown.push('netCarbG');
  if (!isNum(n.fibreG)) unknown.push('fibreG');
  if (!isNum(n.satFatG)) unknown.push('satFatG');
  const energy = sourceEnergyOf(f, asEaten);
  const extra: Record<string, number | null> = {};
  for (const k of EXTRA_KEYS) if (isNum(n[k])) extra[k] = n[k] as number;
  if (f.polyolsG) {
    extra.polyolsG = recordPolyolsG(f);
    for (const [id, v] of Object.entries(f.polyolsG)) if (isNum(v) && v >= 0) extra[polyolIdentityKey(id)] = v;
  }
  const imputed = imputedKeysOf(f, energy.basis);
  return {
    energyKcal: energy.kcal,
    proteinG: n.proteinG,
    netCarbG: carb.availableG ?? 0,
    fatG: n.fatG,
    fibreG: isNum(n.fibreG) ? n.fibreG : 0,
    satFatG: isNum(n.satFatG) ? n.satFatG : 0,
    ...(unknown.length > 0 ? { unknown } : {}),
    ...(isNum(n.alcoholG) && n.alcoholG >= 0 ? { alcoholG: n.alcoholG } : {}),
    ...(isNum(n.caffeineMg) && n.caffeineMg >= 0 ? { caffeineMg: n.caffeineMg } : {}),
    extra,
    carbStatus: carb.status === 'unresolved' ? 'unresolved' : carb.legacyAssumed ? 'legacyAssumed' : 'resolved',
    energyBasis: energy.basis,
    ...(energy.basis === 'measuredME' ? { sourceEnergyKcal: n.energyKcal } : {}),
    ...(imputed.length > 0 ? { imputed } : {}),
    energySource: energy,
  };
}

/**
 * Snapshot keys whose value a record's source imputed (per-nutrient provenance `imputed`; D6-05). A measured-ME energy is
 * never imputed (it replaces the source energy); available carbohydrate is imputed when the reported carbohydrate is.
 */
export function imputedKeysOf(f: Pick<FoodRecord, 'per100g' | 'provenance' | 'measuredME'>, energyBasis: 'source' | 'measuredME' = sourceEnergyOf(f).basis): string[] {
  const np = f.provenance?.nutrientProvenance;
  if (!np) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(np)) {
    if (v !== 'imputed' || !isNum((f.per100g as unknown as Record<string, unknown>)[k])) continue;
    if (k === 'energyKcal' && energyBasis === 'measuredME') continue;
    out.push(k);
    if (k === 'carbG') out.push('netCarbG');
  }
  return out.sort();
}

/**
 * (A1-024) Basis of a label/typed carbohydrate that states none, version 2: unknown. Stored label components logged under
 * version 1 carry no `carbBasis` and are read through the explicit `legacyTotalByDifference` adapter; every new label
 * component stores its basis (the default included), so absence on a stored component means version 1.
 */
export const LABEL_CARB_BASIS_DEFAULT = { version: 2, basis: 'unknown' } as const satisfies { version: number; basis: CarbohydrateBasis };

const LABEL_FIELDS = ['energyKcal', 'proteinG', 'fatG', 'carbG', 'fibreG', 'satFatG'] as const;
type LabelField = (typeof LABEL_FIELDS)[number];
/** (D6-03) optional label fields carried as extra nutrients when printed (polyols by total; salt is not converted here). */
const LABEL_EXTRA_FIELDS = ['sugarsG', 'polyolsG', 'sodiumMg', 'potassiumMg', 'calciumMg', 'ironMg', 'cholesterolMg', 'vitDUg'] as const;

/** The label's values as given: a number, or null when the field is not given (absent or printed as not given). */
export function labelFieldsOf(label: Record<string, unknown>): Record<LabelField, number | null> | null {
  const out = {} as Record<LabelField, number | null>;
  for (const k of LABEL_FIELDS) {
    const v = label[k];
    if (v === undefined || v === null) out[k] = null;
    else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    else out[k] = v;
  }
  return out;
}

/** The label's optional extra fields as given (null = printed as not given); null when one is not a finite number ≥ 0. */
export function labelExtraOf(label: Record<string, unknown>): Partial<Record<(typeof LABEL_EXTRA_FIELDS)[number], number | null>> | null {
  const out: Partial<Record<(typeof LABEL_EXTRA_FIELDS)[number], number | null>> = {};
  for (const k of LABEL_EXTRA_FIELDS) {
    const v = label[k];
    if (v === undefined) continue;
    if (v === null) out[k] = null;
    else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
    else out[k] = v;
  }
  return out;
}

/**
 * Per-100 g values of a transcribed label or the person's numbers (C3/D6-02). Energy alone, or energy with some macros, is
 * a valid label: the fields it does not give stay unknown. Without energy every macro (protein, fat, carbohydrate) is needed
 * and energy is the convention energy. Null when neither holds or a value is not a finite number ≥ 0.
 *
 * Carbohydrate (D6-01, A1-024): a declared `available` basis is used as is; a declared total-by-difference subtracts fibre
 * once (no fibre given ⇒ available carbohydrate unknown); monosaccharide-equivalent / unknown bases stay unknown. An
 * UNDECLARED basis is unknown: the printed carbohydrate, fibre and energy are kept and available carbohydrate stays
 * unknown (never a guessed subtraction, so never a manufactured energy conflict). `legacyTotalByDifference` is the explicit,
 * versioned adapter of stored entries logged before this rule (`LABEL_CARB_BASIS_DEFAULT`): it keeps their declared legacy
 * reading (carbohydrate − fibre, fibre not given ⇒ nothing subtracted), labelled `legacyAssumed`. The printed
 * carbohydrate stays in `extra.carbG`; identified polyols are their own field, never subtracted by a factor.
 */
export function per100OfLabel(label: Record<string, unknown>, carbBasis: CarbohydrateBasis = LABEL_CARB_BASIS_DEFAULT.basis): Per100 | null {
  const f = labelFieldsOf(label);
  const x = labelExtraOf(label);
  if (!f || !x) return null;
  let net: number | null;
  if (f.carbG === null) net = null;
  else if (carbBasis === 'legacyTotalByDifference') net = Math.max(0, f.carbG - (f.fibreG ?? 0));
  else net = availableCarbohydrate({ reportedG: f.carbG, basis: carbBasis, fibreG: f.fibreG }).availableG;
  // identified polyols are inside a printed carbohydrate total but are not available (glucose-forming) carbohydrate: their
  // MASS leaves the available pool, their energy stays in the printed total (no universal polyol factor)
  const polyols = isNum(x.polyolsG) ? x.polyolsG : 0;
  if (net !== null && polyols > 0) net = polyols <= net + 1e-9 ? Math.max(0, net - polyols) : null;
  let energy = f.energyKcal;
  if (energy === null) {
    if (f.proteinG === null || f.fatG === null || net === null) return null;
    energy = 4 * f.proteinG + 4 * net + 9 * f.fatG + 2 * (f.fibreG ?? 0);
  }
  const unknown: Array<keyof MealTotals> = [];
  const val = (v: number | null, k: keyof MealTotals): number => {
    if (v === null) {
      unknown.push(k);
      return 0;
    }
    return v;
  };
  const extra: Record<string, number | null> = { ...x };
  if (f.carbG !== null) extra.carbG = f.carbG;
  const out: Per100 = {
    energyKcal: energy, proteinG: val(f.proteinG, 'proteinG'), netCarbG: val(net, 'netCarbG'), fatG: val(f.fatG, 'fatG'), fibreG: val(f.fibreG, 'fibreG'), satFatG: val(f.satFatG, 'satFatG'),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
    ...(f.carbG !== null ? { carbStatus: carbBasis === 'legacyTotalByDifference' ? ('legacyAssumed' as const) : net === null ? ('unresolved' as const) : ('resolved' as const) } : {}),
  };
  return unknown.length > 0 ? { ...out, unknown } : out;
}

/* ------------------------------------------------------------------------------------------- recipes (D6-04) */

/** One recipe ingredient as the arithmetic reads it (legacy `gramsRaw` maps to `massG` with a legacy basis). */
export interface RecipeIngredientIn {
  foodId: string;
  massG: number;
  massBasis: 'asPurchased' | 'edible' | 'legacyUnknown';
  /**
   * (A1-043) State of the MEASURED mass (and so of the source it is read against): raw, cooked or as eaten. It must match
   * the source record; `preparation` is the later transformation (it never re-labels the grams).
   */
  state?: 'raw' | 'cooked' | 'asEaten' | 'unknown';
  preparation?: string;
  /** Supported preparation-specific retention factors per nutrient key (absent = none applied). */
  retention?: Partial<Record<string, number>>;
}

/**
 * (A1-044) An added component: the nutrients it adds and, separately, its material mass (edible g) — the mass enters the
 * mass balance only when given — and optionally its identity (a food id, never also listed as an ingredient).
 */
export interface RecipeAdditionIn {
  name: string;
  nutrients: Partial<Record<string, number>>;
  massG?: number;
  foodId?: string;
}

/** A recipe definition as the arithmetic reads it (schema 2, or a legacy recipe normalised by `normalizeRecipe`). */
export interface RecipeSpec {
  schemaVersion: 1 | 2;
  ingredients: readonly RecipeIngredientIn[];
  finalEdibleMassG?: number;
  yieldSource: 'measured' | 'sourcedEstimate' | 'unknown';
  servings?: number;
  additions?: ReadonlyArray<RecipeAdditionIn>;
  discards?: ReadonlyArray<{ kind: 'oil' | 'liquid' | 'other'; massG?: number; nutrients?: Partial<Record<string, number>> }>;
  waterAddedG?: number;
  evaporationG?: number;
}

/** (A1-030) The energy method one ingredient's source used in the batch (only ingredients with a measured-ME alternative). */
export interface RecipeEnergySource {
  ingredient: number;
  foodId: string;
  method: SourceEnergy['method'];
  form: string | null;
  status: SourceEnergy['status'];
  matrixUncertain?: true;
}

/** (D6-04) A recipe serving as logged: its share of the batch and the batch it came from (immutable). */
export interface RecipeServingSnapshot {
  recipeVersion: string;
  fractionOfBatch: number;
  /** Null when the final edible mass is unknown: the component's grams are then on the ingredient-mass basis. */
  finalEdibleMassG: number | null;
  massBasis: RecipeComposition['massBasis'];
  /** Nutrients of the whole batch (known sums; null = unknown), by key. */
  batch: Readonly<Record<string, number | null>>;
  /** (A1-042) upper bounds of batch nutrients left unknown by an unknown removal (pre-discard total − known removals). */
  batchUpper?: Readonly<Record<string, number>>;
  /** (A1-030) the energy method each ingredient with a measured-ME alternative used, frozen with the serving. */
  energySources?: readonly RecipeEnergySource[];
  /** (A1-043) named assumptions of the batch (identity retention, unstated state), frozen with the serving. */
  assumptions?: readonly string[];
}

/** Nutrient keys a recipe batch tracks (catalogue keys plus available carbohydrate; polyol keys when a source names them). */
const RECIPE_KEYS: readonly string[] = ['netCarbG', ...FOOD_NUTRIENT_KEYS];

export interface RecipeComposition {
  /** Batch nutrient amounts (null = unknown). */
  batch: Record<string, number | null>;
  /**
   * A lower bound of each batch nutrient: the known part when only ingredient composition is missing; 0 when a removal is
   * unknown (an unknown subtraction leaves no positive lower bound — see `batchUpper`).
   */
  batchKnown: Record<string, number>;
  /** (A1-042) Upper bounds of nutrients left unknown by an unknown removal: the pre-discard total minus known removals. */
  batchUpper: Record<string, number>;
  /** Final edible mass of the batch, g, or null (unknown yield: no cooked-gram density). */
  finalEdibleMassG: number | null;
  massBasis: 'measured' | 'sourcedEstimate' | 'massBalance' | 'legacyIngredientSum' | 'unknown';
  /** Σ edible ingredient grams (the legacy dish weight; the bookkeeping basis of a fraction serving without yield). */
  nominalMassG: number;
  /** Per-100 g of the final edible batch, only with a known final mass. */
  per100?: Per100;
  legacy: boolean;
  issues: string[];
  /** (D6-03) keys some ingredient's source imputed (the batch value stays marked imputed). */
  imputed: string[];
  /** (A1-030) the energy method of each ingredient with a measured-ME alternative. */
  energySources: RecipeEnergySource[];
  /**
   * (A1-043) named assumptions: `stateUnstated:<n>` (grams read on the record's own state), `retentionIdentity:<n>` (a raw
   * source cooked without supported retention factors: an identity scenario, not a measured cooked analysis),
   * `rawEquivalentFromYield:<n>` (cooked grams converted with the record's own sourced raw→cooked yield).
   */
  assumptions: string[];
}

const finitePos = (v: unknown): v is number => isNum(v) && v > 0;

/** Validate a recipe spec (finite, positive masses; retention in [0, 1.5]; Infinity/NaN rejected). Returns issues. */
export function validateRecipe(r: RecipeSpec): string[] {
  const issues: string[] = [];
  if (!Array.isArray(r.ingredients) || r.ingredients.length === 0) issues.push('a recipe needs ingredients');
  (r.ingredients ?? []).forEach((i, n) => {
    if (typeof i.foodId !== 'string' || !i.foodId) issues.push(`ingredient ${n + 1}: food id`);
    if (!finitePos(i.massG)) issues.push(`ingredient ${n + 1}: grams must be a finite number > 0`);
    if (!['asPurchased', 'edible', 'legacyUnknown'].includes(i.massBasis)) issues.push(`ingredient ${n + 1}: massBasis`);
    if (i.state !== undefined && !['raw', 'cooked', 'asEaten', 'unknown'].includes(i.state)) issues.push(`ingredient ${n + 1}: state must be raw, cooked, asEaten or unknown`);
    for (const [k, v] of Object.entries(i.retention ?? {})) if (!isNum(v) || v < 0 || v > 1.5) issues.push(`ingredient ${n + 1}: retention ${k} must be in [0, 1.5]`);
  });
  if (r.finalEdibleMassG !== undefined && !finitePos(r.finalEdibleMassG)) issues.push('final edible mass must be a finite number > 0');
  if ((r.yieldSource === 'measured' || r.yieldSource === 'sourcedEstimate') && r.finalEdibleMassG === undefined) issues.push('a measured or sourced yield needs the final edible mass');
  if (r.servings !== undefined && !(isNum(r.servings) && r.servings > 0)) issues.push('servings must be > 0');
  for (const k of ['waterAddedG', 'evaporationG'] as const) if (r[k] !== undefined && !(isNum(r[k]) && r[k]! >= 0)) issues.push(`${k} must be a finite number ≥ 0`);
  for (const d of r.discards ?? []) if (d.massG !== undefined && !(isNum(d.massG) && d.massG >= 0)) issues.push('discarded mass must be a finite number ≥ 0');
  (r.additions ?? []).forEach((a, n) => {
    if (a.massG !== undefined && !(isNum(a.massG) && a.massG >= 0)) issues.push(`addition ${n + 1}: material mass must be a finite number ≥ 0`);
    if (a.foodId !== undefined) {
      const k = typeof a.foodId === 'string' && a.foodId ? (r.ingredients ?? []).findIndex((i) => i.foodId === a.foodId) : -2;
      if (k === -2) issues.push(`addition ${n + 1}: food id`);
      // one physical material is counted once: as an ingredient or as an addition, never both (explicit identity)
      else if (k >= 0) issues.push(`addition ${n + 1} ("${a.name}") is also ingredient ${k + 1}: count it once`);
    }
  });
  for (const a of [...(r.additions ?? []), ...(r.discards ?? [])]) for (const [k, v] of Object.entries(a.nutrients ?? {})) if (!isNum(v) || v < 0) issues.push(`nutrient ${k} must be a finite number ≥ 0`);
  return issues;
}

/**
 * Per-100 g value of one recipe key for a record (available carbohydrate on its basis; the form-resolved energy; null =
 * unknown). Identified polyols: a record that identifies none adds none identified (its carbohydrate keeps any unidentified
 * sugar alcohol inside available carbohydrate, so nothing is lost or counted twice).
 */
function recordValue(f: FoodRecord, key: string, form: AsEatenForm | null): number | null {
  if (key === 'netCarbG') return availableCarbOf(f).availableG;
  if (key === 'energyKcal') return sourceEnergyOf(f, form).kcal;
  if (key === 'alcoholG') return isNum(f.per100g.alcoholG) ? f.per100g.alcoholG : 0; // records list ethanol only when present
  if (key === 'polyolsG') return recordPolyolsG(f);
  if (key.startsWith(POLYOL_IDENTITY_KEY_PREFIX)) {
    for (const [id, v] of Object.entries(f.polyolsG ?? {})) if (polyolIdentityKey(id) === key) return isNum(v) && v >= 0 ? v : null;
    return 0;
  }
  const v = (f.per100g as unknown as Record<string, unknown>)[key];
  return isNum(v) ? v : null;
}

/**
 * What a discarded material can carry (A1-042): drained oil carries the lipid phase (energy, fat and its fractions,
 * cholesterol, fat-soluble vitamins) and structurally no protein, carbohydrate, fibre, minerals or water-soluble
 * vitamins; a liquid or other discard can carry anything. A nutrient the discard can carry and does not state is an
 * unknown removal; a stated 0 is a known zero removal.
 */
const OIL_CARRIES: ReadonlySet<string> = new Set(['energyKcal', 'fatG', 'satFatG', 'mufaG', 'pufaG', 'epaG', 'dhaG', 'alaG', 'cholesterolMg', 'vitDUg', 'vitARaeUg']);
function discardCarries(kind: 'oil' | 'liquid' | 'other', key: string): boolean {
  return kind === 'oil' ? OIL_CARRIES.has(key) : true;
}

/** Measured state of an ingredient's grams says cooked (stated, or as eaten after a cooking preparation). */
function measuredCooked(i: RecipeIngredientIn): boolean {
  return i.state === 'cooked' || (i.state === 'asEaten' && !!i.preparation && stateOfText(i.preparation) === 'cooked');
}

/**
 * Batch composition of a recipe (D6-04). Refuse converts once (as purchased × edible fraction; without a fraction the
 * edible mass is unknown). The state of an ingredient's grams must match its source record (A1-043): cooked grams of a raw
 * record convert only through the record's own sourced raw→cooked yield, otherwise the recipe needs review (never 100
 * cooked grams read as 100 raw grams); raw grams of a cooked record need review. Retention applies once, only to a RAW
 * source and only where a factor is given; a raw source cooked without factors keeps an identity scenario named in
 * `assumptions`. Additions add the nutrients they list; a discard subtracts the nutrients it lists, and each nutrient it
 * can carry but does not list is an unknown removal (A1-042): that batch value is unknown with an upper bound (the
 * pre-discard total minus known removals). Water added or evaporated changes mass only. Final mass: measured or sourced
 * estimate; else a mass balance when every material term is known — ingredients, additions' own masses (A1-044),
 * discards, water and evaporation; else unknown. Energy uses the form-resolved source energy of each ingredient under its
 * preparation (A1-030). Legacy recipes keep their arithmetic (dish weight = Σ ingredient grams).
 */
export function recipeComposition(r: RecipeSpec, table: FoodTable): RecipeComposition {
  const issues = validateRecipe(r);
  const legacy = r.schemaVersion === 1;
  const recs = r.ingredients.map((i) => table.get(i.foodId));
  recs.forEach((f, n) => {
    if (!f) issues.push(`ingredient ${n + 1}: "${r.ingredients[n]!.foodId}" is not in the food table`);
  });
  const edible = r.ingredients.map((i, n) => (recs[n] && finitePos(i.massG) ? ingredientEdibleMassG(i.massG, i.massBasis, recs[n]!.edibleFraction).edibleG : null));
  const assumptions: string[] = [];
  // (A1-043) the grams the nutrient arithmetic reads against each source record (null = unknown or needs review)
  const sourceMass: Array<number | null> = r.ingredients.map((i, n) => {
    const f = recs[n];
    const e = edible[n] ?? null;
    if (!f || e === null || legacy) return e;
    const cooked = measuredCooked(i);
    let mass = e;
    if (cooked && f.state === 'raw') {
      if (!finitePos(f.yieldRawToCooked)) {
        issues.push(`ingredient ${n + 1}: its grams are cooked but "${f.name}" is a raw record; choose the matching cooked record or give the raw grams`);
        return null;
      }
      assumptions.push(`rawEquivalentFromYield:${n + 1}`);
      mass = e / f.yieldRawToCooked;
    } else if (i.state === 'raw' && f.state === 'cooked') {
      issues.push(`ingredient ${n + 1}: its grams are raw but "${f.name}" is a cooked record; choose the raw record or give the cooked grams`);
      return null;
    } else if ((i.state === undefined || i.state === 'unknown') && f.state !== 'as-eaten') assumptions.push(`stateUnstated:${n + 1}`);
    const transformed = cooked || (!!i.preparation && stateOfText(i.preparation) === 'cooked');
    if (f.state === 'raw' && transformed && Object.keys(i.retention ?? {}).length === 0) assumptions.push(`retentionIdentity:${n + 1}`);
    return mass;
  });
  const forms = r.ingredients.map((i) => (i.preparation ? asEatenFormOf({ preparation: i.preparation }) : null));
  const energySources: RecipeEnergySource[] = r.ingredients.flatMap((i, n) => {
    const f = recs[n];
    if (!f) return [];
    const e = sourceEnergyOf(f, forms[n]);
    return e.status === 'noAlternative' ? [] : [{ ingredient: n + 1, foodId: i.foodId, method: e.method, form: e.form, status: e.status, ...(e.matrixUncertain ? { matrixUncertain: true as const } : {}) }];
  });
  // polyol keys only when a source names polyols (absence is not a statement)
  const polyolKeys = new Set<string>();
  for (const f of recs) {
    if (!f?.polyolsG) continue;
    polyolKeys.add('polyolsG');
    for (const id of Object.keys(f.polyolsG)) polyolKeys.add(polyolIdentityKey(id));
  }
  for (const a of r.additions ?? []) for (const k of Object.keys(a.nutrients ?? {})) if (k === 'polyolsG' || k.startsWith(POLYOL_IDENTITY_KEY_PREFIX)) polyolKeys.add(k);
  const keys = [...RECIPE_KEYS, ...polyolKeys];
  const batch: Record<string, number | null> = {};
  const batchKnown: Record<string, number> = {};
  const batchUpper: Record<string, number> = {};
  for (const key of keys) {
    const parts = r.ingredients.map((i, n) => {
      const f = recs[n];
      const per100 = f ? recordValue(f, key, forms[n] ?? null) : null;
      const retention = f && f.state === 'raw' ? i.retention?.[key] : undefined;
      return { edibleG: sourceMass[n] ?? null, per100, ...(retention !== undefined ? { retention } : {}) };
    });
    const added = (r.additions ?? []).reduce((s, a) => s + (isNum(a.nutrients[key]) ? a.nutrients[key]! : 0), 0);
    let discarded = 0;
    let discardUnknown = false;
    for (const d of r.discards ?? []) {
      const v = d.nutrients?.[key];
      if (isNum(v)) discarded += v;
      else if (discardCarries(d.kind, key)) discardUnknown = true;
    }
    const res = recipeBatchNutrient(parts, added, discarded);
    // more discarded than the batch can hold is an inconsistent record (named), not silently clamped away
    if (res.value !== null && res.value < -1e-6) issues.push(`more ${key} discarded than the batch contains`);
    // an unknown removal from a batch that holds none of the nutrient still leaves exactly none
    const boundedToZero = discardUnknown && res.value !== null && res.value <= 1e-9;
    batch[key] = (discardUnknown && !boundedToZero) || res.value === null ? null : Math.max(0, res.value);
    batchKnown[key] = discardUnknown ? 0 : Math.max(0, res.knownSum);
    if (discardUnknown && !boundedToZero && res.value !== null) batchUpper[key] = Math.max(0, res.value);
  }
  const nominal = edible.reduce<number>((s, e) => s + (e ?? 0), 0);
  const imputed = [...new Set(recs.flatMap((f) => (f ? imputedKeysOf(f) : [])))].sort();
  let finalMass: number | null = null;
  let massBasis: RecipeComposition['massBasis'] = 'unknown';
  const additions = r.additions ?? [];
  const discards = r.discards ?? [];
  if (legacy) {
    finalMass = nominal > 0 ? nominal : null;
    massBasis = 'legacyIngredientSum';
  } else if ((r.yieldSource === 'measured' || r.yieldSource === 'sourcedEstimate') && finitePos(r.finalEdibleMassG)) {
    finalMass = r.finalEdibleMassG;
    massBasis = r.yieldSource;
  } else if (isNum(r.evaporationG) && edible.every((e) => e !== null) && discards.every((d) => isNum(d.massG)) && additions.every((a) => isNum(a.massG))) {
    // every material once: ingredients + additions' own masses + water − evaporation − discards (A1-044)
    const m = nominal + additions.reduce((s, a) => s + a.massG!, 0) + (r.waterAddedG ?? 0) - r.evaporationG - discards.reduce((s, d) => s + d.massG!, 0);
    if (m > 0) {
      finalMass = m;
      massBasis = 'massBalance';
    }
  }
  const extraKeys = (k: string): boolean =>
    polyolKeys.has(k) || r.ingredients.some((_, n) => recs[n] && isNum((recs[n]!.per100g as unknown as Record<string, unknown>)[k])) || additions.some((a) => isNum(a.nutrients?.[k]));
  let per100: Per100 | undefined;
  if (finalMass !== null && issues.length === 0) {
    const p = (k: string): number | null => per100FromBatch(batch[k] ?? null, finalMass);
    const unknown: Array<keyof MealTotals> = [];
    const v = (k: keyof MealTotals, key: string = k): number => {
      const x = p(key);
      if (x === null) {
        unknown.push(k);
        return 0;
      }
      return x;
    };
    const extra: Record<string, number | null> = {};
    for (const k of [...EXTRA_KEYS, ...polyolKeys]) if (extraKeys(k)) extra[k] = p(k);
    const alc = p('alcoholG');
    const cafKnown = recs.every((f) => f && isNum(f.per100g.caffeineMg));
    const upper = upperPer100(batchUpper, finalMass);
    per100 = {
      energyKcal: v('energyKcal'), proteinG: v('proteinG'), netCarbG: v('netCarbG'), fatG: v('fatG'), fibreG: v('fibreG'), satFatG: v('satFatG'),
      ...(unknown.length > 0 ? { unknown } : {}),
      ...(alc !== null && alc > 0 ? { alcoholG: alc } : {}),
      ...(cafKnown && p('caffeineMg') !== null ? { caffeineMg: p('caffeineMg')! } : {}),
      extra,
      carbStatus: batch.netCarbG === null ? 'unresolved' : 'resolved',
      ...(imputed.length > 0 ? { imputed } : {}),
      ...(upper ? { upper } : {}),
    };
  }
  return { batch, batchKnown, batchUpper, finalEdibleMassG: finalMass, massBasis, nominalMassG: nominal, ...(per100 ? { per100 } : {}), legacy, issues, imputed, energySources, assumptions };
}

/** Per-100 g upper bounds of a batch's bounded unknowns on a mass basis (undefined when there are none). */
function upperPer100(batchUpper: Readonly<Record<string, number>>, mass: number): Record<string, number> | undefined {
  const out: Record<string, number> = {};
  for (const [k, u] of Object.entries(batchUpper)) {
    const x = per100FromBatch(u, mass);
    if (x !== null) out[k] = x;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * Per-100 g of the nominal (ingredient-mass) basis, so `grams = fraction × nominalMass` reproduces fraction × batch exactly
 * for a recipe without a known final mass. Never a cooked-gram density: the stored serving carries `finalEdibleMassG: null`.
 */
export function nominalPer100(c: RecipeComposition): Per100 | undefined {
  if (!(c.nominalMassG > 0) || c.issues.length > 0) return undefined;
  const p = (k: string): number | null => per100FromBatch(c.batch[k] ?? null, c.nominalMassG);
  const unknown: Array<keyof MealTotals> = [];
  const v = (k: keyof MealTotals, key: string = k): number => {
    const x = p(key);
    if (x === null) {
      unknown.push(k);
      return 0;
    }
    return x;
  };
  const extra: Record<string, number | null> = {};
  const polyolKeys = Object.keys(c.batch).filter((k) => k === 'polyolsG' || k.startsWith(POLYOL_IDENTITY_KEY_PREFIX));
  for (const k of [...EXTRA_KEYS, ...polyolKeys]) if (c.batch[k] !== undefined && (c.batch[k] !== null || c.batchKnown[k]! > 0 || c.batchUpper[k] !== undefined)) extra[k] = p(k);
  const alc = p('alcoholG');
  const upper = upperPer100(c.batchUpper ?? {}, c.nominalMassG);
  return {
    energyKcal: v('energyKcal'), proteinG: v('proteinG'), netCarbG: v('netCarbG'), fatG: v('fatG'), fibreG: v('fibreG'), satFatG: v('satFatG'),
    ...(unknown.length > 0 ? { unknown } : {}),
    ...(alc !== null && alc > 0 ? { alcoholG: alc } : {}),
    extra,
    carbStatus: c.batch.netCarbG === null ? 'unresolved' : 'resolved',
    ...(c.imputed.length > 0 ? { imputed: c.imputed } : {}),
    ...(upper ? { upper } : {}),
  };
}

/** A stored recipe document (legacy `gramsRaw` or schema 2) → the arithmetic's spec. */
export function normalizeRecipe(doc: { schemaVersion?: number; ingredients?: ReadonlyArray<Record<string, unknown>>; finalEdibleMassG?: unknown; yieldSource?: unknown; servings?: unknown; additions?: unknown; discards?: unknown; waterAddedG?: unknown; evaporationG?: unknown }): RecipeSpec {
  const v2 = doc.schemaVersion === 2;
  const ingredients: RecipeIngredientIn[] = (doc.ingredients ?? []).map((i) => {
    const massG = (isNum(i.massG) ? i.massG : i.gramsRaw) as number;
    const basis = v2 && (i.massBasis === 'asPurchased' || i.massBasis === 'edible') ? i.massBasis : 'legacyUnknown';
    return {
      foodId: String(i.foodId ?? ''),
      massG,
      massBasis: basis,
      ...(typeof i.state === 'string' ? { state: i.state as RecipeIngredientIn['state'] } : {}),
      ...(typeof i.preparation === 'string' ? { preparation: i.preparation } : {}),
      ...(typeof i.retention === 'object' && i.retention !== null ? { retention: i.retention as Record<string, number> } : {}),
    };
  });
  return {
    schemaVersion: v2 ? 2 : 1,
    ingredients,
    ...(isNum(doc.finalEdibleMassG) ? { finalEdibleMassG: doc.finalEdibleMassG } : {}),
    yieldSource: v2 && (doc.yieldSource === 'measured' || doc.yieldSource === 'sourcedEstimate') ? doc.yieldSource : 'unknown',
    ...(isNum(doc.servings) ? { servings: doc.servings } : {}),
    ...(v2 && Array.isArray(doc.additions) ? { additions: doc.additions as RecipeSpec['additions'] } : {}),
    ...(v2 && Array.isArray(doc.discards) ? { discards: doc.discards as RecipeSpec['discards'] } : {}),
    ...(v2 && isNum(doc.waterAddedG) ? { waterAddedG: doc.waterAddedG } : {}),
    ...(v2 && isNum(doc.evaporationG) ? { evaporationG: doc.evaporationG } : {}),
  };
}

/** Per-100 g values of a legacy recipe (raw ingredient grams; the dish's weight is taken as the sum of its ingredients). */
export function per100OfRecipe(ingredients: ReadonlyArray<{ foodId: string; gramsRaw: number }>, table: FoodTable): Per100 | undefined {
  const c = recipeComposition(normalizeRecipe({ ingredients: ingredients as unknown as Array<Record<string, unknown>> }), table);
  return c.issues.length === 0 ? c.per100 : undefined;
}

/* ------------------------------------------------------------------------------------------- the meal */

const r1 = (x: number): number => Math.round(x * 10) / 10;
const banded = (value: number, sd: number): Banded => ({ value: r1(value), sd: r1(sd), low: r1(Math.max(0, value - sd)), high: r1(value + sd) });

const KEYS: ReadonlyArray<readonly [BandedKey, keyof MealTotals, Macro]> = [
  ['energyKcal', 'energyKcal', 'energy'],
  ['proteinG', 'proteinG', 'protein'],
  ['carbG', 'netCarbG', 'carb'],
  ['fatG', 'fatG', 'fat'],
  ['fibreG', 'fibreG', 'carb'],
];
/** (D6-03) optional nutrients banded in the totals when every resolved component gives them. */
const OPTIONAL: ReadonlyArray<readonly ['satFatG' | 'sugarsG' | 'sodiumMg', Macro]> = [
  ['satFatG', 'fat'],
  ['sugarsG', 'carb'],
  ['sodiumMg', 'energy'],
];

function floorOf(c: ResolvedComponent, m: Macro): number {
  const base = BAND_FLOORS[c.band][m];
  const fatty = (c.cookingMethod && FATTY.test(c.cookingMethod)) || c.visibleFatCue === 'glossy' || c.visibleFatCue === 'pooled';
  return fatty ? base * (m === 'energy' || m === 'fat' ? 1.3 : 1.15) : base;
}

const ZERO_BAND: Banded = { value: 0, sd: 0, low: 0, high: 0 };

/** Value of an optional nutrient per 100 g of a component's source (satFatG from the totals, others from `extra`). */
function optionalPer100(p: Per100, k: 'satFatG' | 'sugarsG' | 'sodiumMg'): number | null {
  if (k === 'satFatG') return p.unknown?.includes('satFatG') ? null : p.satFatG;
  const v = p.extra?.[k];
  return isNum(v) ? v : null;
}

/** The per-100 g snapshot record of a component's values (unknown fields null), for the nutrient ledger. */
export function per100Record(p: Per100): Record<string, number | null> {
  const unknown = new Set<keyof MealTotals>(p.unknown ?? []);
  const v = (k: keyof MealTotals): number | null => (unknown.has(k) ? null : p[k]);
  return {
    energyKcal: v('energyKcal'), proteinG: v('proteinG'), netCarbG: v('netCarbG'), fatG: v('fatG'), fibreG: v('fibreG'), satFatG: v('satFatG'),
    ...(p.alcoholG !== undefined ? { alcoholG: p.alcoholG } : {}),
    ...(p.caffeineMg !== undefined ? { caffeineMg: p.caffeineMg } : {}),
    ...(p.extra ?? {}),
    // a measured-ME food keeps its source energy beside the measured value (audit; consumers never add both)
    ...(p.energyBasis === 'measuredME' && p.sourceEnergyKcal !== undefined ? { sourceEnergyKcal: p.sourceEnergyKcal } : {}),
    // (A1-042) upper bounds of values unknown through an unknown removal, never lower bounds
    ...Object.fromEntries(Object.entries(p.upper ?? {}).map(([k, u]) => [`${UPPER_BOUND_KEY_PREFIX}${k}`, u])),
  };
}

/**
 * Compute a meal: nutrients = grams × per-100 g values, with bands and confidence. Unresolved components add nothing. A
 * field unknown in a component is unknown in that component and in the meal totals (0 placeholder, listed in `unknown`,
 * known partial sum in `lowerBounds`); it never enters the sum as a measured zero. Every other nutrient goes through the
 * shared accumulator (`nutrients`), which marks a nutrient partial when any resolved component does not give it.
 */
export function estimateMeal(components: readonly ResolvedComponent[]): MealEstimate {
  const acc = Object.fromEntries(KEYS.map(([k]) => [k, { v: 0, var: 0, floor: 0, unknown: false }])) as Record<BandedKey, { v: number; var: number; floor: number; unknown: boolean }>;
  const opt = Object.fromEntries(OPTIONAL.map(([k]) => [k, { v: 0, var: 0, floor: 0, unknown: false, any: false }])) as Record<(typeof OPTIONAL)[number][0], { v: number; var: number; floor: number; unknown: boolean; any: boolean }>;
  const out: MealEstimate['components'] = [];
  const unresolved: number[] = [];
  const alc = { v: 0, var: 0, floor: 0, any: false };
  const caf = { v: 0, listed: 0, resolved: 0 };
  components.forEach((c, i) => {
    const conf = Math.max(0, Math.min(1, c.idConfidence * AMOUNT_CONF[c.amount]));
    if (!c.per100) {
      unresolved.push(i);
      out.push({ ...c, confidence: 0 });
      return;
    }
    const sigmaG = Math.max(0, c.gramsHigh - c.gramsLow) / 3.3;
    const n = {} as BandedTotals;
    const unknown: BandedKey[] = [];
    for (const [k, pk, m] of KEYS) {
      if (c.per100.unknown?.includes(pk)) {
        n[k] = ZERO_BAND;
        unknown.push(k);
        acc[k].unknown = true;
        continue;
      }
      const perG = c.per100[pk] / 100;
      const v = perG * c.grams;
      const sd = Math.sqrt((perG * sigmaG) ** 2 + (v * TABLE_ERROR) ** 2);
      const floor = floorOf(c, m) * v;
      n[k] = banded(v, Math.max(sd, floor));
      acc[k].v += v;
      acc[k].var += sd * sd;
      acc[k].floor += floor;
    }
    if (unknown.length > 0) n.unknown = unknown;
    for (const [k, m] of OPTIONAL) {
      const p = optionalPer100(c.per100, k);
      if (p === null) {
        opt[k].unknown = true;
        continue;
      }
      const v = (p / 100) * c.grams;
      const sd = Math.sqrt(((p / 100) * sigmaG) ** 2 + (v * TABLE_ERROR) ** 2);
      const floor = floorOf(c, m) * v;
      n[k] = banded(v, Math.max(sd, floor));
      opt[k].v += v;
      opt[k].var += sd * sd;
      opt[k].floor += floor;
      opt[k].any = true;
    }
    if (c.per100.alcoholG !== undefined && c.per100.alcoholG > 0) {
      const perG = c.per100.alcoholG / 100;
      const v = perG * c.grams;
      const sd = Math.sqrt((perG * sigmaG) ** 2 + (v * TABLE_ERROR) ** 2);
      const floor = floorOf(c, 'energy') * v;
      n.alcoholG = banded(v, Math.max(sd, floor));
      alc.v += v;
      alc.var += sd * sd;
      alc.floor += floor;
      alc.any = true;
    }
    caf.resolved++;
    if (c.per100.caffeineMg !== undefined) {
      caf.v += (c.per100.caffeineMg / 100) * c.grams;
      caf.listed++;
    }
    out.push({ ...c, nutrients: n, confidence: conf });
  });
  const totals = Object.fromEntries(KEYS.map(([k]) => [k, acc[k].unknown ? ZERO_BAND : banded(acc[k].v, Math.max(Math.sqrt(acc[k].var), acc[k].floor))])) as unknown as BandedTotals;
  const unknownTotals = KEYS.flatMap(([k]) => (acc[k].unknown ? [k] : []));
  const lowerBounds: Partial<Record<BandedKey, number>> = {};
  for (const k of unknownTotals) lowerBounds[k] = r1(acc[k].v);
  if (unknownTotals.length > 0) totals.unknown = unknownTotals;
  for (const [k] of OPTIONAL) if (opt[k].any && !opt[k].unknown) totals[k] = banded(opt[k].v, Math.max(Math.sqrt(opt[k].var), opt[k].floor));
  if (alc.any) totals.alcoholG = banded(alc.v, Math.max(Math.sqrt(alc.var), alc.floor));
  const weights = out.map((c) => Math.max(0, c.nutrients?.energyKcal.value ?? 0));
  const wsum = weights.reduce((s, w) => s + w, 0);
  let confidence = out.length === 0 ? 0 : wsum > 0 ? out.reduce((s, c, i) => s + c.confidence * weights[i]!, 0) / wsum : out.reduce((s, c) => s + c.confidence, 0) / out.length;
  if (unresolved.length > 0) confidence = Math.min(confidence, 0.39);
  const resolved = components.filter((c) => c.per100);
  const nutrients = aggregateSnapshots(resolved.map((c, i) => ({ componentId: String(i), per100: per100Record(c.per100!), edibleG: c.grams, ...(c.per100!.imputed ? { imputed: c.per100!.imputed } : {}) })));
  return {
    components: out,
    totals,
    confidence: Math.round(confidence * 100) / 100,
    lowConfidence: out.flatMap((c, i) => (c.confidence < 0.7 ? [i] : [])),
    unresolved,
    ...(unknownTotals.length > 0 ? { lowerBounds } : {}),
    ...(caf.listed > 0 ? { caffeineMg: { knownSum: r1(caf.v), complete: caf.listed === caf.resolved && unresolved.length === 0 } } : {}),
    nutrients,
    band: BAND_SEMANTICS,
  };
}

const est = (b: Banded): Est => ({ value: b.value, sd: b.sd });

/** The log entry's `NutrientEstimate` of banded totals (carbohydrate = net, engine convention; unknown fields listed). */
export function toNutrientEstimate(t: BandedTotals): NutrientEstimate {
  return {
    energyKcal: est(t.energyKcal), proteinG: est(t.proteinG), carbG: est(t.carbG), fatG: est(t.fatG), fibreG: est(t.fibreG),
    ...(t.alcoholG ? { alcoholG: est(t.alcoholG) } : {}),
    ...(t.satFatG ? { satFatG: est(t.satFatG) } : {}),
    ...(t.sugarsG ? { sugarsG: est(t.sugarsG) } : {}),
    ...(t.sodiumMg ? { sodiumMg: est(t.sodiumMg) } : {}),
    ...(t.unknown && t.unknown.length > 0 ? { unknown: [...t.unknown] } : {}),
  };
}

/**
 * (D6-08, A1-030) The energy method frozen on a logged table component: the measured-ME form it used, or the source
 * convention (with the as-eaten matrix and whether a form-specific alternative did not apply), and the source energy.
 */
export interface EnergySourceSnapshot {
  method: SourceEnergy['method'];
  form: string | null;
  status: SourceEnergy['status'];
  sourceEnergyKcal: number;
  sourceRef?: string;
  matrixUncertain?: true;
}

/** The frozen energy method of a resolved table food (absent for labels, typed numbers and recipes). */
export function energySourceSnapshotOf(e: SourceEnergy): EnergySourceSnapshot {
  return { method: e.method, form: e.form, status: e.status, sourceEnergyKcal: e.sourceKcal, ...(e.sourceRef ? { sourceRef: e.sourceRef } : {}), ...(e.matrixUncertain ? { matrixUncertain: true as const } : {}) };
}

/**
 * A stored component with its D6-04 recipe-serving snapshot, the D6-03 imputed snapshot keys and the D6-08 energy method
 * (additive fields of the immutable entry).
 */
export type MealComponentOut = MealComponent & { recipeServing?: RecipeServingSnapshot; imputedNutrients?: readonly string[]; energySource?: EnergySourceSnapshot };

/** The log entry's components (resolved ones only). */
export function toMealComponents(e: MealEstimate): MealComponentOut[] {
  return e.components
    .filter((c) => c.nutrients)
    .map((c) => ({
      name: c.name,
      ...(c.localName ? { localName: c.localName } : {}),
      ...(c.foodId ? { foodId: c.foodId } : {}),
      ...(c.recipeId ? { recipeId: c.recipeId } : {}),
      grams: { value: c.grams, sd: r1(Math.max(0, c.gramsHigh - c.gramsLow) / 3.3) },
      ...(c.cookingMethod ? { cookingMethod: c.cookingMethod } : {}),
      ...(c.visibleFatCue ? { visibleFatCue: c.visibleFatCue } : {}),
      nutrients: toNutrientEstimate(c.nutrients!),
      nutrientSource: c.nutrientSource ?? 'table',
      ...(c.amountMethod ? { amountMethod: c.amountMethod } : {}),
      ...(c.carbBasis ? { carbBasis: c.carbBasis } : {}),
      ...(c.snapshot ? { snapshot: c.snapshot } : {}),
      ...(c.recipeServing ? { recipeServing: c.recipeServing } : {}),
      ...(c.per100?.imputed && c.per100.imputed.length > 0 ? { imputedNutrients: [...c.per100.imputed] } : {}),
      ...(c.per100?.energySource && c.per100.energySource.status !== 'noAlternative' ? { energySource: energySourceSnapshotOf(c.per100.energySource) } : {}),
    }));
}
