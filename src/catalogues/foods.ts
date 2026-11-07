/**
 * Food reference interface and meal arithmetic (R4 §2.4, §4.3). The bundled reference is a frozen FDC selection
 * (`src/content/catalogues/foods.reference.ts`, D6-05); this module defines the contract every table implements, the one
 * record validator every entry path uses (bundle, custom foods, cached/synced documents), and the deterministic arithmetic
 * the app uses so the model never states nutrient totals (R4 decision 1).
 *
 * Carbohydrate (D6-01): a record's `carbG` is the reported value on its declared basis (`carbBasis`; absent = the legacy
 * total-by-difference contract, labelled legacy-assumed, never inferred from geography). Available carbohydrate subtracts
 * fibre exactly once and only for a fibre-inclusive total; an `available` record is never fibre-subtracted again.
 *
 * Source energy (D6-08): `sourceEnergyOf` is the one dependency-neutral resolver every consumer uses (planning totals,
 * candidates, portion fitting, logging, recipes): a form-specific measured ME replaces the source energy once, and only for
 * the form it was measured on.
 */
import { availableCarbohydrate, type CarbohydrateBasis } from '@/lib/bodyContracts';
import { matchScore, normName } from './text';
import type { FoodRecord, FoodTable, MealTotals, NutrientKey, Nutrients, SourceAwareMealTotals } from './types';

/** An in-memory `FoodTable` over records (ids must be unique). */
export function createFoodTable(records: readonly FoodRecord[], version: string): FoodTable {
  const byId = new Map<string, FoodRecord>();
  for (const r of records) {
    if (byId.has(r.id)) throw new Error(`duplicate food id ${r.id}`);
    byId.set(r.id, r);
  }
  const all = [...records];
  return {
    version,
    get: (id) => byId.get(id),
    all: () => all,
    search(query, limit = 10) {
      return all
        .map((r) => ({ r, s: matchScore(query, [r.name, ...r.aliases]) }))
        .filter((x) => x.s > 0.2)
        .sort((a, b) => b.s - a.s || a.r.id.localeCompare(b.r.id))
        .slice(0, limit)
        .map((x) => x.r);
    },
  };
}

/* ------------------------------------------------------------------------------------------- validation (D6-05) */

/** Every per-100 g nutrient key a record may carry (catalogue units in the key name: G, Mg, Ug, Kcal). */
export const FOOD_NUTRIENT_KEYS: readonly NutrientKey[] = [
  'energyKcal', 'proteinG', 'fatG', 'carbG', 'fibreG', 'sugarsG', 'satFatG', 'mufaG', 'pufaG', 'epaG', 'dhaG', 'alaG', 'cholesterolMg', 'waterG',
  'alcoholG', 'caffeineMg', 'sodiumMg', 'potassiumMg', 'calciumMg', 'ironMg', 'magnesiumMg', 'zincMg', 'b12Ug', 'folateDfeUg', 'vitDUg', 'vitCMg',
  'vitARaeUg', 'leucineG', 'lysineG',
];
export const CARB_BASES: readonly CarbohydrateBasis[] = ['available', 'totalByDifference', 'monosaccharideEquivalent', 'labelConvention', 'legacyTotalByDifference', 'unknown'];

/**
 * Analytical tolerances of the validator (engineering checks, not physiology): independently assayed fractions need not
 * sum exactly (D6-05), so masses may exceed 100 g/100 g by 5 g and fibre may exceed a fibre-inclusive total by 0.5 g.
 * Energy above 902 kcal/100 g (pure fat at 9.02) is not a food.
 */
export const FOOD_VALIDATION = { massSumMaxG: 105, fibreOverTotalToleranceG: 0.5, energyMaxKcal: 902 } as const;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const MACROS = ['energyKcal', 'proteinG', 'fatG', 'carbG'] as const;

/** Carbohydrate basis a record declares (absent = the legacy total-by-difference contract). */
export function carbBasisOf(r: Pick<FoodRecord, 'carbBasis'>): CarbohydrateBasis {
  return r.carbBasis ?? 'legacyTotalByDifference';
}

/** Fibre is part of the reported carbohydrate only for these bases (fibre ≤ carbohydrate holds only for them). */
export function fibreInclusive(basis: CarbohydrateBasis): boolean {
  return basis === 'totalByDifference' || basis === 'legacyTotalByDifference';
}

/**
 * Validate a food record (any entry path: bundle, `catalogue.addFood`, cached or synced documents). Returns the issues
 * (empty = valid). Required macros finite ≥ 0; every optional nutrient that is present finite ≥ 0 (NaN, Infinity, negative
 * or non-numbers are rejected before arithmetic, never normalised); a declared basis from the vocabulary; fibre ≤ total
 * only for fibre-inclusive bases; analytical mass/energy tolerances; portions, edible fraction, yield, polyols and a
 * measured ME finite and in range.
 */
export function validateFoodRecord(r: unknown): string[] {
  const issues: string[] = [];
  if (!isObj(r)) return ['food record is not an object'];
  if (!isStr(r.id) || !r.id.trim()) issues.push('food id');
  if (!isStr(r.name) || !r.name.trim()) issues.push('food name');
  const n = r.per100g;
  if (!isObj(n)) return [...issues, 'per100g is required (nutrients per 100 g)'];
  for (const k of MACROS) if (!isNum(n[k]) || (n[k] as number) < 0) issues.push(`per100g.${k} must be a finite number ≥ 0`);
  for (const [k, v] of Object.entries(n)) {
    if (!(FOOD_NUTRIENT_KEYS as readonly string[]).includes(k)) issues.push(`unknown nutrient ${k}`);
    else if ((MACROS as readonly string[]).includes(k)) continue;
    else if (v !== undefined && (!isNum(v) || v < 0)) issues.push(`per100g.${k} must be a finite number ≥ 0`);
  }
  const basis = r.carbBasis === undefined ? 'legacyTotalByDifference' : r.carbBasis;
  if (!(CARB_BASES as readonly unknown[]).includes(basis)) issues.push('carbBasis must be one of ' + CARB_BASES.join(', '));
  if (issues.length > 0) return issues;
  const p = n as unknown as Nutrients;
  const inclusive = fibreInclusive(basis as CarbohydrateBasis);
  const mass = p.proteinG + p.fatG + p.carbG + (p.alcoholG ?? 0) + (inclusive ? 0 : (p.fibreG ?? 0));
  if (mass > FOOD_VALIDATION.massSumMaxG) issues.push('protein, fat and carbohydrate add up to more than 100 g per 100 g');
  if (p.energyKcal > FOOD_VALIDATION.energyMaxKcal) issues.push('energy above 900 kcal (3 770 kJ) per 100 g');
  if (inclusive && (p.fibreG ?? 0) > p.carbG + FOOD_VALIDATION.fibreOverTotalToleranceG) issues.push('fibre is part of carbohydrate (carbohydrate by difference) and cannot exceed it');
  if (r.portions !== undefined && (!Array.isArray(r.portions) || !r.portions.every((x) => isObj(x) && isStr(x.label) && isNum(x.g) && x.g > 0 && x.g <= 5000))) issues.push('portions must be [{ label, g }] with 0 < g ≤ 5000');
  if (r.edibleFraction !== undefined && !(isNum(r.edibleFraction) && r.edibleFraction > 0 && r.edibleFraction <= 1)) issues.push('edibleFraction must be in (0, 1]');
  if (r.yieldRawToCooked !== undefined && !(isNum(r.yieldRawToCooked) && r.yieldRawToCooked > 0)) issues.push('yieldRawToCooked must be a finite number > 0');
  if (r.polyolsG !== undefined && (!isObj(r.polyolsG) || !Object.values(r.polyolsG).every((v) => isNum(v) && v >= 0))) issues.push('polyolsG must map polyol names to grams ≥ 0');
  if (r.measuredME !== undefined) {
    const m = r.measuredME;
    if (!isObj(m) || !isNum(m.kcalPer100g) || m.kcalPer100g < 0 || m.kcalPer100g > FOOD_VALIDATION.energyMaxKcal || !isStr(m.sourceRef) || !['sourceME', 'unavailableSubstrate', 'netEnergy'].includes(m.represents as string))
      issues.push('measuredME must be { kcalPer100g ≥ 0, sourceRef, represents }');
  }
  if (r.state !== undefined && !['raw', 'cooked', 'as-eaten'].includes(r.state as string)) issues.push('state must be raw, cooked or as-eaten');
  return issues;
}

/** A validated table: malformed records are quarantined (named with their issues), never silently normalised (D6-05). */
export interface ValidatedFoodTable {
  table: FoodTable;
  quarantined: ReadonlyArray<{ id: string | null; issues: readonly string[] }>;
}

/** Build a table from records of mixed trust: invalid records and later duplicates of an id are quarantined. */
export function createValidatedFoodTable(records: readonly unknown[], version: string): ValidatedFoodTable {
  const ok: FoodRecord[] = [];
  const seen = new Set<string>();
  const quarantined: Array<{ id: string | null; issues: readonly string[] }> = [];
  for (const r of records) {
    const issues = validateFoodRecord(r);
    const id = isObj(r) && isStr(r.id) ? r.id : null;
    if (issues.length > 0) quarantined.push({ id, issues });
    else if (seen.has(id!)) quarantined.push({ id, issues: ['duplicate food id'] });
    else {
      seen.add(id!);
      ok.push(r as unknown as FoodRecord);
    }
  }
  return { table: createFoodTable(ok, version), quarantined };
}

/* ------------------------------------------------------------------------------------------- carbohydrate (D6-01) */

/** Available carbohydrate of a record per 100 g, with status; `upperBoundG` is the reported total (available ≤ it). */
export interface AvailableCarb {
  availableG: number | null;
  status: 'resolved' | 'unresolved';
  reason?: string;
  basis: CarbohydrateBasis;
  /** The reported value as stored (any basis: available carbohydrate never exceeds it). */
  reportedG: number;
  /** True when the basis is the legacy contract (assumed total by difference; correctable). */
  legacyAssumed: boolean;
}

/**
 * Available carbohydrate per 100 g of a record (subtract fibre once, only when included; unknown basis unresolved).
 * Identified polyols (`polyolsG`, inside the printed total on fibre-inclusive and EU available conventions) leave the
 * available pool by mass — they are their own exposure, their energy stays in the record's energy (no universal factor).
 */
export function availableCarbOf(r: Pick<FoodRecord, 'per100g' | 'carbBasis' | 'polyolsG'>): AvailableCarb {
  const basis = carbBasisOf(r);
  const n = r.per100g;
  const res = availableCarbohydrate({ reportedG: n.carbG, basis, fibreG: n.fibreG ?? null, ...(r.polyolsG ? { polyolsG: r.polyolsG } : {}) });
  const legacyAssumed = r.carbBasis === undefined;
  const polyols = r.polyolsG ? Object.values(r.polyolsG).reduce((s, v) => s + (isNum(v) ? v : 0), 0) : 0;
  if (res.availableG !== null && polyols > 0) {
    if (polyols > res.availableG + 1e-9) return { availableG: null, status: 'unresolved', reason: 'polyolsExceedCarbohydrate', basis, reportedG: n.carbG, legacyAssumed };
    return { availableG: res.availableG - polyols, status: 'resolved', basis, reportedG: n.carbG, legacyAssumed };
  }
  return { availableG: res.availableG, status: res.status, ...(res.reason ? { reason: res.reason } : {}), basis, reportedG: n.carbG, legacyAssumed };
}

/**
 * Net (available) carbohydrate per 100 g for PLANNING arithmetic (portion fitting, day rules): the resolved available
 * value; when it is unresolved, the reported total as a conservative upper bound (never a fabricated subtraction). A
 * legacy record without fibre keeps its historical arithmetic (nothing subtracted). Logging uses `availableCarbOf`, which
 * keeps unresolved values unknown. Passing only `Nutrients` means the legacy basis.
 */
export function netCarbPer100g(n: Readonly<Nutrients>, basis: CarbohydrateBasis = 'legacyTotalByDifference'): number {
  const a = availableCarbohydrate({ reportedG: n.carbG, basis, fibreG: n.fibreG ?? null });
  if (a.availableG !== null) return Math.max(0, a.availableG);
  return Math.max(0, n.carbG);
}

/** `netCarbPer100g` of a whole record (its declared basis). */
export function netCarbOfFood(r: Pick<FoodRecord, 'per100g' | 'carbBasis' | 'polyolsG'>): number {
  const a = availableCarbOf(r);
  return a.availableG !== null ? Math.max(0, a.availableG) : netCarbPer100g(r.per100g, carbBasisOf(r));
}

/** Σ identified polyols of a record, g per 100 g (0 when the record identifies none). */
export function polyolsOf(r: Pick<FoodRecord, 'polyolsG'>): number {
  return r.polyolsG ? Object.values(r.polyolsG).reduce((s, v) => s + (isNum(v) && v >= 0 ? v : 0), 0) : 0;
}

/**
 * Planning carbohydrate of a record per 100 g (D6-01/D6-08, one normalisation for candidates, filters, fitting and their
 * displays): `netCarbG` is the record-aware value of `netCarbOfFood` (resolved available carbohydrate, or the reported total
 * as a labelled upper bound when unresolved); `lowG`/`highG` bound the glucose-forming carbohydrate: an unresolved basis
 * spans 0 … reported (no fabricated subtraction) and identified polyols, whose glucose route is not modelled, add their
 * mass to the upper bound only (a bound, never an allocation). `status` is `resolved` only when the value is exact.
 */
export interface PlanningCarb {
  netCarbG: number;
  lowG: number;
  highG: number;
  status: 'resolved' | 'bounded';
  reason?: 'basisUnresolved' | 'polyolRouteUnmodelled';
  polyolG: number;
}

export function planningCarbOf(r: Pick<FoodRecord, 'per100g' | 'carbBasis' | 'polyolsG'>): PlanningCarb {
  const a = availableCarbOf(r);
  const polyolG = polyolsOf(r);
  const net = a.availableG !== null ? Math.max(0, a.availableG) : netCarbPer100g(r.per100g, carbBasisOf(r));
  if (a.availableG === null) return { netCarbG: net, lowG: 0, highG: Math.max(net, Math.max(0, r.per100g.carbG)), status: 'bounded', reason: 'basisUnresolved', polyolG };
  if (polyolG > 0) return { netCarbG: net, lowG: net, highG: net + polyolG, status: 'bounded', reason: 'polyolRouteUnmodelled', polyolG };
  return { netCarbG: net, lowG: net, highG: net, status: 'resolved', polyolG };
}

/* ------------------------------------------------------------------------------------------- source energy (D6-08) */

/** Physical matrix of a food as eaten (the cell-wall structure a form-specific measured ME depends on). */
export type MatrixForm = 'whole' | 'pieces' | 'ground';

/**
 * As-eaten form read from what was said about the food: `matrix` (null = not stated), roasting, and processing the
 * reference cannot place (`unknownProcessing`: a stated preparation such as boiling, soaking or an unrecognised step).
 */
export interface AsEatenForm {
  matrix: MatrixForm | null;
  roasted: boolean;
  unknownProcessing: boolean;
}

const GROUND_WORDS = /\b(ground|grind|grinding|grinded|grated|paste|butter|powder|powdered|flour|blended|puree|pureed)\b/;
const PIECE_WORDS = /\b(chopped|sliced|slivered|crushed|flaked|diced|halved|split|broken|pieces|piece|bits)\b/;
const WHOLE_WORDS = /\b(whole|kernel|kernels)\b/;
const ROAST_WORDS = /\b(roast|roasted|toasted|fried|baked)\b/;
/** Preparation words that leave the matrix as recorded (no transformation). */
const NEUTRAL_WORDS = /\b(raw|natural|plain|unroasted|unsalted|fresh|as is|none|uncooked)\b/;

/**
 * The as-eaten form of a food from a stated preparation/cooking method (`preparation`: an unplaced step there is unknown
 * processing) and descriptive words (component name, portion label: only matrix and roasting words count there).
 */
export function asEatenFormOf(o: { preparation?: string | null; describe?: ReadonlyArray<string | null | undefined> }): AsEatenForm {
  const prep = normName(o.preparation ?? '');
  const words = [prep, ...(o.describe ?? []).map((d) => normName(d ?? ''))].join(' ');
  const matrix: MatrixForm | null = GROUND_WORDS.test(words) ? 'ground' : PIECE_WORDS.test(words) ? 'pieces' : WHOLE_WORDS.test(words) ? 'whole' : null;
  const roasted = ROAST_WORDS.test(words);
  const placed = GROUND_WORDS.test(prep) || PIECE_WORDS.test(prep) || WHOLE_WORDS.test(prep) || ROAST_WORDS.test(prep) || NEUTRAL_WORDS.test(prep);
  // any other stated step (boiled, soaked, blanched, cooked in a curry…) is processing the measured forms do not cover
  const other = /\b(boil|boiled|steam|steamed|soak|soaked|sprout|sprouted|blanch|blanched|cook|cooked|stew|stewed|simmer|simmered|saute|sauteed|temper|tempered|caramelised|caramelized|candied|coated|smoked|microwaved|pressure)\b/.test(prep);
  return { matrix, roasted, unknownProcessing: prep.length > 0 && (other || !placed) };
}

/** Matrix and roasting of each measured-ME form the reference may name (a form outside this list is not eligible). */
export const MEASURED_ME_FORMS: Readonly<Record<string, { matrix: MatrixForm; roasted: boolean | null }>> = {
  wholeNatural: { matrix: 'whole', roasted: false },
  wholeRoasted: { matrix: 'whole', roasted: true },
  chopped: { matrix: 'pieces', roasted: null },
  choppedRoasted: { matrix: 'pieces', roasted: true },
  butter: { matrix: 'ground', roasted: null },
};

/**
 * The energy a record contributes per 100 g, chosen once (D6-08). A measured ME replaces the source energy only when it is
 * a source-ME alternative with a species, a validated form and a source, AND the as-eaten form matches that form: grinding,
 * slicing or roasting a whole-natural record, or a preparation the reference cannot place, removes the alternative — the
 * source energy is then kept as its labelled convention (`matrixUncertain`), never replaced by another form's coefficient.
 * Never stacked with another discount.
 */
export interface SourceEnergy {
  kcal: number;
  basis: 'source' | 'measuredME';
  /** The source's own energy per 100 g (kept for audit; never added to a measured ME). */
  sourceKcal: number;
  method: 'measuredME' | 'sourceConvention';
  /** The measured form when the alternative is used; else the as-eaten matrix (null = not stated). */
  form: string | null;
  sourceRef?: string;
  status: 'measuredForm' | 'noAlternative' | 'alternativeUnsupported' | 'formIncompatible' | 'processingUnknown';
  /** The record has a form-specific alternative that does not apply to this form: the convention energy has matrix uncertainty. */
  matrixUncertain: boolean;
}

export function sourceEnergyOf(f: Pick<FoodRecord, 'per100g' | 'measuredME'>, asEaten?: AsEatenForm | null): SourceEnergy {
  const sourceKcal = f.per100g.energyKcal;
  const m = f.measuredME;
  const convention = (status: SourceEnergy['status'], matrixUncertain: boolean): SourceEnergy => ({ kcal: sourceKcal, basis: 'source', sourceKcal, method: 'sourceConvention', form: asEaten?.matrix ?? null, status, matrixUncertain });
  if (!m || m.represents !== 'sourceME') return convention('noAlternative', false);
  const spec = isStr(m.form) ? MEASURED_ME_FORMS[m.form] : undefined;
  if (!isNum(m.kcalPer100g) || m.kcalPer100g < 0 || !isStr(m.species) || !m.species.trim() || !spec || !isStr(m.sourceRef) || !m.sourceRef.trim()) return convention('alternativeUnsupported', false);
  if (asEaten?.unknownProcessing) return convention('processingUnknown', true);
  if (asEaten && ((asEaten.matrix !== null && asEaten.matrix !== spec.matrix) || (asEaten.roasted && spec.roasted === false))) return convention('formIncompatible', true);
  return { kcal: m.kcalPer100g, basis: 'measuredME', sourceKcal, method: 'measuredME', form: m.form!, sourceRef: m.sourceRef, status: 'measuredForm', matrixUncertain: false };
}

const ZERO: MealTotals = { energyKcal: 0, proteinG: 0, netCarbG: 0, fatG: 0, fibreG: 0, satFatG: 0 };

/**
 * Planning totals with their source status (D6-01/D6-08): `energyKcal` is the shared source energy (`sourceEnergyOf`, the
 * same value logging uses for the record's own form), `sourceEnergyKcal` the source energy before any measured-ME
 * alternative (audit, never added); `netCarbG` the record-aware planning carbohydrate with its glucose-forming bounds.
 */
export type PlanningTotals = SourceAwareMealTotals;

/**
 * Totals of a list of components (grams of edible portion) for planning and its numeric displays. Unknown food ids throw:
 * the caller resolves names first. Energy is the shared source energy (a measured-ME form replaces the source energy once,
 * as logging does); carbohydrate follows `planningCarbOf` (a labelled upper bound when unresolved); absent optional fields
 * add 0 here (planning arithmetic) — logging keeps them unknown (`commands/food/estimate.ts`).
 */
export function mealTotals(components: ReadonlyArray<{ foodId: string; grams: number }>, table: FoodTable): PlanningTotals {
  const t: PlanningTotals = { ...ZERO, sourceEnergyKcal: 0, carbStatus: 'resolved', netCarbLowG: 0, netCarbHighG: 0, polyolG: 0 };
  for (const c of components) {
    const f = table.get(c.foodId);
    if (!f) throw new Error(`unknown food ${c.foodId}`);
    const k = Math.max(0, c.grams) / 100;
    const n = f.per100g;
    const e = sourceEnergyOf(f);
    const carb = planningCarbOf(f);
    t.energyKcal += e.kcal * k;
    t.sourceEnergyKcal += e.sourceKcal * k;
    t.proteinG += n.proteinG * k;
    t.netCarbG += carb.netCarbG * k;
    t.netCarbLowG += carb.lowG * k;
    t.netCarbHighG += carb.highG * k;
    t.polyolG += carb.polyolG * k;
    if (carb.status === 'bounded' && k > 0) t.carbStatus = 'bounded';
    t.fatG += n.fatG * k;
    t.fibreG += (n.fibreG ?? 0) * k;
    t.satFatG += (n.satFatG ?? 0) * k;
  }
  return t;
}

/* ------------------------------------------------------------------------------------------- state-first matching */

/** Preparation state words in a name or request (D6-05: state/fortification match before aliases). */
const STATE_WORDS: ReadonlyArray<readonly [RegExp, FoodRecord['state']]> = [
  // cooked words first: "dry roasted" is cooked; "uncooked" never matches \bcooked\b
  [/\b(cooked|boiled|steamed|roasted|fried|baked|grilled|stewed)\b/, 'cooked'],
  [/\b(raw|uncooked|dry|dried|unroasted)\b/, 'raw'],
];

/** The preparation state a text names, if any (`raw` / `cooked`). */
export function stateOfText(text: string): FoodRecord['state'] | undefined {
  const t = normName(text);
  for (const [re, s] of STATE_WORDS) if (re.test(t)) return s;
  return undefined;
}

/** Whether a record's state is compatible with a requested one (as-eaten records are compatible with either). */
export function stateCompatible(record: Pick<FoodRecord, 'state'>, wanted: FoodRecord['state'] | undefined): boolean {
  if (!wanted || record.state === 'as-eaten' || wanted === 'as-eaten') return true;
  return record.state === wanted;
}

/** The fortification a text names, if any ("enriched rice" → true, "unfortified flour" → false). */
export function fortificationOfText(text: string): boolean | undefined {
  const t = normName(text);
  if (/\b(unfortified|unenriched|non fortified|not fortified|non enriched)\b/.test(t)) return false;
  if (/\b(fortified|enriched)\b/.test(t)) return true;
  return undefined;
}

/** Whether a record's fortification is compatible with a requested one (either side unknown = compatible). */
export function fortificationCompatible(record: Pick<FoodRecord, 'fortified'>, wanted: boolean | undefined): boolean {
  return wanted === undefined || record.fortified === undefined || record.fortified === wanted;
}

/* ------------------------------------------------------------------------------------------- display bands (D6-06) */

/**
 * What every food band in the app means (D6-06, C6): an UNCALIBRATED heuristic display band (input-method floors and a
 * lognormal display spread), neither a validated SD nor P10/P90 predictive coverage. Versioned so a later calibrated
 * model cannot be confused with these defaults; legacy summaries keep this version.
 */
export const FOOD_BAND_SEMANTICS = { uncertaintyKind: 'heuristic', calibrated: false, coverage: 'unvalidated', version: 1 } as const;

/** R4 §4.3 log-input kinds and their display σ_log for energy (UNCALIBRATED display assumptions, R4 §4.1). */
export const LOG_SIGMA = {
  weighed: { sigma: 0.08, fatMult: 1.0 },
  household: { sigma: 0.2, fatMult: 1.0 },
  textNoAmounts: { sigma: 0.35, fatMult: 1.05 },
  photoOnly: { sigma: 0.3, fatMult: 1.1 },
  photoText: { sigma: 0.22, fatMult: 1.05 },
} as const;
export type LogInputKind = keyof typeof LOG_SIGMA;

/**
 * R4 §4.3 display band of a logged amount: E·exp(∓1.2816σ) around the point estimate; restaurant food adds 0.10 to σ;
 * protein σ = 0.8·σ, fat σ = 1.3·σ, carbohydrate σ = σ. `p10`/`p90` are legacy field names of the band ENDPOINTS, not
 * percentiles: `semantics` says the band is an uncalibrated heuristic (`FOOD_BAND_SEMANTICS`); `low`/`high` repeat them.
 */
export function logBand(
  value: number,
  kind: LogInputKind,
  nutrient: 'energy' | 'protein' | 'carb' | 'fat' = 'energy',
  restaurant = false,
): { p10: number; p50: number; p90: number; low: number; high: number; sigmaLog: number; confidence: 'high' | 'medium' | 'low'; semantics: typeof FOOD_BAND_SEMANTICS } {
  const base = LOG_SIGMA[kind].sigma + (restaurant ? 0.1 : 0);
  const sigma = nutrient === 'protein' ? 0.8 * base : nutrient === 'fat' ? 1.3 * base : base;
  const z = 1.2816;
  const low = value * Math.exp(-z * sigma);
  const high = value * Math.exp(z * sigma);
  return {
    p10: low,
    p50: value,
    p90: high,
    low,
    high,
    sigmaLog: sigma,
    confidence: base <= 0.12 ? 'high' : base <= 0.25 ? 'medium' : 'low',
    semantics: FOOD_BAND_SEMANTICS,
  };
}
