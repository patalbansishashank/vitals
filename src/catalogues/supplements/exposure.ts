/**
 * Active-ingredient exposure of the person's supplement rows (D7-04, C3). Pure.
 *
 * A row records a product and an amount; its physiological exposure is the ACTIVE ingredient in the active's own form:
 *   dose_i = recorded amount / label serving amount × label active amount_i   (after compatible unit conversion)
 * Elemental magnesium/iron/calcium, sodium versus sodium chloride, EPA+DHA versus fish-oil mass, protein versus powder and
 * nitrate mmol are never interchanged (`activeExposureFromServing`, the shared contract). A count (tablets, capsules,
 * scoops, ml) without the exact product's label has UNKNOWN potency: the row stays a valid record, its exposure is
 * unknown (no number, never zero) and its safety check is `unchecked` — never a passed upper-limit assessment. No universal
 * scoop or capsule potency is assumed; a catalogue amount counts only when the row is in the unit the catalogue names the
 * active in ("mg elemental", "g EPA+DHA", "g protein", "mmol nitrate", "g sodium", IU/µg vitamin D).
 *
 * Schedules keep their shape: a weekly or alternate-day regimen keeps its dose-day (peak/bolus) amount, its weekly total
 * and its daily average side by side — an intermittent dose is never cleared only by dividing it by seven or two, nor
 * condemned only because one dose day exceeds a daily limit (`upperLimitAssessment` returns `unchecked` with an
 * intermittent-regimen review instead). Legacy rows without a schedule keep the app's existing reading (taking now, at the
 * chosen times of day, every day), labelled as that assumption.
 *
 * Upper limits (`UPPER_LIMITS`) are the catalogue's own adult numbers with their scope made explicit: magnesium counts
 * supplements and medications only; vitamin D, calcium, iron and caffeine count total intake (food + supplements). A
 * total-intake limit with unknown food intake can prove a violation from the supplements alone (a known lower bound above
 * the limit) but cannot pass. Taking is observed exposure only: it is not consent to continue, escalate or a proven
 * saturation; on-hand stock has no physiological exposure at all.
 */
import { EXPOSURE_UNITS, activeExposureFromServing, convertActiveAmount, type ExposureId, type ExposureQuantity, type SafetyCheckStatus } from '@/lib/bodyContracts';
import { supplementRecord } from './dose';
import { recurrenceOf, type RecurrenceKind } from './schedule';
import type { SupplementRow } from './types';

/* ------------------------------------------------------------------------------------------- catalogue actives */

/**
 * The active a catalogue item's own unit names (the catalogue dose unit, e.g. "mg elemental"), with the unit a row must be
 * in for its amount to count as that active. `basisUnresolved`: the catalogue unit gives a mass but not the form
 * (calcium "mg": elemental or compound?) — the amount is then only an upper bound of the elemental mass.
 */
export interface CatalogueActive {
  ingredient?: ExposureId;
  /** Units whose number is the active amount (mass units convert; 'IU' only for vitamin D, 40 IU = 1 µg). */
  units?: readonly string[];
  form?: string;
  basisUnresolved?: true;
  /**
   * Actives the product may carry in unknown amounts without its label (a multivitamin's minerals, a fasting electrolyte's
   * magnesium/potassium): each is an unknown contribution — never a credit and never zero (D7-04/D8-08).
   */
  unknownActives?: readonly ExposureId[];
}

export const CATALOGUE_ACTIVES: Readonly<Record<string, CatalogueActive>> = {
  whey_protein: { ingredient: 'protein', units: ['g'] },
  plant_protein: { ingredient: 'protein', units: ['g'] },
  casein_presleep: { ingredient: 'protein', units: ['g'] },
  creatine_monohydrate: { ingredient: 'creatine', units: ['g'], form: 'monohydrate' },
  caffeine: { ingredient: 'caffeine', units: ['mg'] },
  electrolytes_fasting: { ingredient: 'sodium', units: ['g', 'mg'], form: 'elemental', unknownActives: ['magnesium', 'potassium'] },
  electrolytes_sweat_lowcarb: { ingredient: 'sodium', units: ['g', 'mg'], form: 'elemental' },
  magnesium: { ingredient: 'magnesium', units: ['mg'], form: 'elemental' },
  vitamin_d3: { ingredient: 'vitD', units: ['IU', 'µg'] },
  omega3_epa_dha: { ingredient: 'epaDha', units: ['g'] },
  vitamin_b12: { ingredient: 'b12', units: ['µg'] },
  iron: { ingredient: 'iron', units: ['mg'], form: 'elemental' },
  calcium: { ingredient: 'calcium', units: ['mg'], basisUnresolved: true },
  dietary_nitrate: { ingredient: 'nitrate', units: ['mmol'] },
  multivitamin_low_energy: { unknownActives: ['calcium', 'magnesium', 'iron', 'zinc', 'iodine', 'vitD', 'b12', 'folateDfe', 'vitARae', 'vitC'] },
  iodine_iodised_salt: { unknownActives: ['iodine'] },
  potassium_salt_substitute: { unknownActives: ['potassium', 'sodium'] },
};

/** 1 µg vitamin D (D2 or D3) = 40 IU (definition); one constant, owned by the shared converter (A1-026). */
export { VITAMIN_D_IU_PER_UG } from '@/lib/bodyContracts';

/* ------------------------------------------------------------------------------------------- one occasion */

export type ExposureReason = 'potencyUnknown' | 'basisUnknown' | 'noActiveIdentity' | 'servingIncompatible' | 'basisNotConvertible' | 'unitIncompatible' | 'noDose';

/** One active of one occasion: its amount (null = unknown) with any proven bound, and why it is unknown. */
export interface OccasionActive {
  ingredient: ExposureId;
  unit: string;
  value: number | null;
  /** Known bounds when the value is unknown (an unresolved compound mass bounds the elemental mass from above). */
  upperBound?: number;
  form?: string;
  provenance: 'label' | 'catalogueUnit';
  reason?: ExposureReason;
}

/**
 * Amount to the active's canonical unit through the ONE ingredient-aware converter shared with labels and logs (A1-026):
 * mass g/mg/µg; IU → µg for vitamin D only; mmol stays mmol. A catalogue unit names the active itself (no salt basis).
 */
function toCanonical(ingredient: ExposureId, amount: number, unit: string): number | null {
  return convertActiveAmount(ingredient, amount, unit).value;
}

/**
 * The actives of ONE occasion of a row (its `dose` in its `unit`): from the exact product's label when the row has one,
 * else from the catalogue unit when the row is in a unit that names the active; anything else is potency unknown. A
 * free-text row without a label has no active identity (an empty list, never a guessed ingredient).
 */
export function occasionActives(row: Pick<SupplementRow, 'supplementId' | 'dose' | 'unit' | 'product' | 'schedule'>): OccasionActive[] {
  const dose = row.dose ?? row.schedule?.servingsPerOccasion;
  const unit = row.unit ?? (row.dose === undefined && row.schedule?.servingsPerOccasion !== undefined ? row.product?.servingUnit : undefined);
  if (row.product) {
    if (dose === undefined || !Number.isFinite(dose) || !unit) return row.product.actives.map((a) => ({ ingredient: a.ingredient, unit: EXPOSURE_UNITS[a.ingredient], value: null, provenance: 'label', reason: 'noDose' }));
    return activeExposureFromServing({ amount: dose, unit }, row.product).map((q: ExposureQuantity & { reason?: string }) => ({
      ingredient: q.id,
      unit: q.unit,
      value: q.value,
      ...(q.form ? { form: q.form } : {}),
      provenance: 'label',
      ...(q.value === null ? { reason: (q.reason as ExposureReason | undefined) ?? 'potencyUnknown' } : {}),
    }));
  }
  const rec = supplementRecord(row.supplementId);
  const cat = rec ? CATALOGUE_ACTIVES[rec.id] : undefined;
  if (!cat) return [];
  const unknowns: OccasionActive[] = (cat.unknownActives ?? []).map((ingredient) => ({ ingredient, unit: EXPOSURE_UNITS[ingredient], value: null, provenance: 'catalogueUnit', reason: 'potencyUnknown' }));
  if (!cat.ingredient) return unknowns;
  const base = { ingredient: cat.ingredient, unit: EXPOSURE_UNITS[cat.ingredient], provenance: 'catalogueUnit' as const, ...(cat.form ? { form: cat.form } : {}) };
  if (dose === undefined || !Number.isFinite(dose) || !unit) return [{ ...base, value: null, reason: 'noDose' }, ...unknowns];
  if (!cat.units?.includes(unit)) return [{ ...base, value: null, reason: 'potencyUnknown' }, ...unknowns];
  const v = toCanonical(cat.ingredient, dose, unit);
  if (v === null) return [{ ...base, value: null, reason: 'unitIncompatible' }, ...unknowns];
  // a mass whose form the catalogue does not state bounds the elemental mass from above (elemental ≤ compound mass)
  if (cat.basisUnresolved) return [{ ...base, value: null, upperBound: v, reason: 'basisUnknown' }, ...unknowns];
  return [{ ...base, value: v }, ...unknowns];
}

/* ------------------------------------------------------------------------------------------- schedule */

export { isDoseDay, recurrenceOf, type RecurrenceKind } from './schedule';

/** One active of one row over its schedule: dose-day (peak) amount, daily average, weekly total (null = unknown). */
export interface ScheduledActive extends OccasionActive {
  supplementId: string | null;
  recurrence: RecurrenceKind;
  perOccasion: number | null;
  /** Amount on a dose day (per occasion × occasions): the bolus a daily limit is compared with on that day. */
  peakDay: number | null;
  peakDayUpperBound?: number;
  /** Mean over the recurrence (null when the frequency is unknown). */
  dailyAverage: number | null;
  dailyAverageUpperBound?: number;
  weeklyTotal: number | null;
}

/** The scheduled actives of one row (its observed taking, not a plan's continuation). */
export function rowActives(row: SupplementRow): ScheduledActive[] {
  const rec = recurrenceOf(row);
  return occasionActives(row).map((a) => {
    const n = rec.occasionsPerDoseDay;
    const perWeek = rec.doseDaysPerWeek;
    const peak = a.value === null ? null : a.value * n;
    const peakUb = a.upperBound !== undefined ? a.upperBound * n : undefined;
    const weekly = peak === null || perWeek === null ? null : peak * perWeek;
    const out: ScheduledActive = {
      ...a,
      supplementId: row.supplementId,
      recurrence: rec.kind,
      perOccasion: a.value,
      peakDay: peak,
      dailyAverage: weekly === null ? null : weekly / 7,
      weeklyTotal: weekly,
    };
    if (peakUb !== undefined) {
      out.peakDayUpperBound = peakUb;
      if (perWeek !== null) out.dailyAverageUpperBound = (peakUb * perWeek) / 7;
    }
    return out;
  });
}

/* ------------------------------------------------------------------------------------------- aggregation */

/** Exposure of one active ingredient summed over products (known sums as lower bounds when a contributor is unknown). */
export interface IngredientExposure {
  ingredient: ExposureId;
  unit: string;
  /** Daily average over the products' recurrences; null when any contributor is unknown. */
  dailyAverage: number | null;
  /** Known part of the daily average (unknown additions are nonnegative). */
  dailyAverageLowerBound: number;
  /** A proven upper bound of the daily average, when every contributor has one. */
  dailyAverageUpperBound?: number;
  /** Dose-day amount if every product's dose day coincides (an upper bound of the true peak when schedules differ). */
  peakDay: number | null;
  peakDayLowerBound: number;
  peakDayUpperBound?: number;
  /** Some contributor is intermittent (weekly, alternate day, dates, as needed): the peak is not the daily average. */
  intermittent: boolean;
  /** Contributing rows (catalogue id or text) with their scheduled actives. */
  contributors: ScheduledActive[];
}

/**
 * Active exposure summed across the rows the person TAKES (observed exposure; on-hand, not-for-me and unknown rows have
 * none), by ingredient. Rows with the same ingredient in different products add up in its canonical unit; an unknown
 * contributor makes the total unknown with the known sum as its lower bound (never zero).
 */
export function aggregateActives(rows: readonly SupplementRow[]): IngredientExposure[] {
  const by = new Map<ExposureId, IngredientExposure>();
  for (const row of rows) {
    if (row.state !== 'taking') continue;
    for (const a of rowActives(row)) {
      let e = by.get(a.ingredient);
      if (!e) {
        e = { ingredient: a.ingredient, unit: a.unit, dailyAverage: 0, dailyAverageLowerBound: 0, dailyAverageUpperBound: 0, peakDay: 0, peakDayLowerBound: 0, peakDayUpperBound: 0, intermittent: false, contributors: [] };
        by.set(a.ingredient, e);
      }
      e.contributors.push(a);
      if (a.recurrence !== 'daily' && a.recurrence !== 'assumedDaily') e.intermittent = true;
      if (a.dailyAverage === null) e.dailyAverage = null;
      else {
        if (e.dailyAverage !== null) e.dailyAverage += a.dailyAverage;
        e.dailyAverageLowerBound += a.dailyAverage;
      }
      const avgUb = a.dailyAverage ?? a.dailyAverageUpperBound;
      if (avgUb === undefined || e.dailyAverageUpperBound === undefined) delete e.dailyAverageUpperBound;
      else e.dailyAverageUpperBound += avgUb;
      if (a.peakDay === null) e.peakDay = null;
      else {
        if (e.peakDay !== null) e.peakDay += a.peakDay;
        e.peakDayLowerBound += a.peakDay;
      }
      const pkUb = a.peakDay ?? a.peakDayUpperBound;
      if (pkUb === undefined || e.peakDayUpperBound === undefined) delete e.peakDayUpperBound;
      else e.peakDayUpperBound += pkUb;
    }
  }
  return [...by.values()];
}

/* ------------------------------------------------------------------------------------------- upper limits */

/**
 * Adult tolerable upper intake levels with their scope (the catalogue's own `upperLimit` numbers; CI checks they agree):
 * `supplementOnly` counts supplements and medications (magnesium), `total` counts food and supplements. Population
 * guidance, not toxicity thresholds; clinician-directed treatment can exceed them with context.
 */
export interface UpperLimitRef {
  supplementId: string;
  ingredient: ExposureId;
  amount: number;
  unit: string;
  scope: 'supplementOnly' | 'total';
  /** Adults only: under this age (or unknown age) the reference does not apply (applicability unresolved). */
  minAgeYears: number;
  /** Age from which another life-stage value applies (not encoded here): applicability unresolved. */
  maxAgeYears?: number;
  kind: 'UL' | 'guidance';
  source: string;
}

export const UPPER_LIMITS: readonly UpperLimitRef[] = [
  { supplementId: 'magnesium', ingredient: 'magnesium', amount: 350, unit: 'mg', scope: 'supplementOnly', minAgeYears: 19, kind: 'UL', source: 'NIH ODS Magnesium fact sheet: UL 350 mg/day from supplements and medications (adults)' },
  { supplementId: 'vitamin_d3', ingredient: 'vitD', amount: 100, unit: 'ug', scope: 'total', minAgeYears: 19, kind: 'UL', source: 'NIH ODS Vitamin D fact sheet: UL 100 µg (4 000 IU)/day total intake (adults)' },
  { supplementId: 'iron', ingredient: 'iron', amount: 45, unit: 'mg', scope: 'total', minAgeYears: 19, kind: 'UL', source: 'NASEM DRI: iron UL 45 mg/day (adults)' },
  { supplementId: 'calcium', ingredient: 'calcium', amount: 2500, unit: 'mg', scope: 'total', minAgeYears: 19, maxAgeYears: 51, kind: 'UL', source: 'NASEM DRI: calcium UL 2 500 mg/day (adults 19–50)' },
  { supplementId: 'caffeine', ingredient: 'caffeine', amount: 400, unit: 'mg', scope: 'total', minAgeYears: 19, kind: 'guidance', source: 'Catalogue upper limit: 400 mg/day for healthy adults (guidance, not a DRI UL)' },
];

export type UpperLimitReason = 'potencyUnknown' | 'basisUnknown' | 'foodIntakeUnknown' | 'frequencyUnknown' | 'intermittentRegimenReview' | 'ageUnresolved' | 'aboveLimit' | 'aboveLimitFromKnownPart';

export interface UpperLimitAssessment {
  ingredient: ExposureId;
  limit: UpperLimitRef;
  status: SafetyCheckStatus;
  /** Usual-intake comparison (daily average) and the dose-day comparison for intermittent regimens. */
  basis: 'usualIntake';
  dailyAverage: number | null;
  dailyAverageLowerBound: number;
  peakDay: number | null;
  reasons: UpperLimitReason[];
}

/** A food intake of the ingredient (shared nutrient ledger): value, or a known lower/upper bound; absent = unknown. */
export interface FoodIntakeBound {
  value: number | null;
  lowerBound?: number;
  upperBound?: number;
}

/**
 * Upper-limit assessment of each aggregated ingredient that has a reference (C5 monotonic rules): a known lower bound
 * above the limit proves a violation; a pass needs a valid upper bound at or under it (unknown potency, an unresolved
 * form, or unknown food for a total-intake limit leaves it `unchecked`, never passed); an intermittent regimen whose
 * dose-day amount exceeds the daily limit while its average does not is `unchecked` (regimen review), not passed by the
 * average. Age unknown or outside the adult reference: `unchecked` (applicability unresolved).
 */
export function upperLimitAssessment(exposures: readonly IngredientExposure[], opts: { ageYears?: number; food?: Partial<Record<ExposureId, FoodIntakeBound>> } = {}): UpperLimitAssessment[] {
  const out: UpperLimitAssessment[] = [];
  for (const e of exposures) {
    const limit = UPPER_LIMITS.find((u) => u.ingredient === e.ingredient);
    if (!limit) continue;
    const reasons: UpperLimitReason[] = [];
    const base = { ingredient: e.ingredient, limit, basis: 'usualIntake' as const, dailyAverage: e.dailyAverage, dailyAverageLowerBound: e.dailyAverageLowerBound, peakDay: e.peakDay };
    const age = opts.ageYears;
    if (age === undefined || !Number.isFinite(age) || age < limit.minAgeYears || (limit.maxAgeYears !== undefined && age >= limit.maxAgeYears)) {
      out.push({ ...base, status: 'unchecked', reasons: ['ageUnresolved'] });
      continue;
    }
    const food = limit.scope === 'total' ? opts.food?.[e.ingredient] : undefined;
    const foodLower = limit.scope === 'total' ? (food?.value ?? food?.lowerBound ?? 0) : 0;
    const foodUpper = limit.scope === 'total' ? (food?.value ?? food?.upperBound) : 0;
    const lower = e.dailyAverageLowerBound + foodLower;
    if (lower > limit.amount + 1e-9) {
      out.push({ ...base, status: 'violation', reasons: [e.dailyAverage === null || foodUpper === undefined ? 'aboveLimitFromKnownPart' : 'aboveLimit'] });
      continue;
    }
    const suppUpper = e.dailyAverage ?? e.dailyAverageUpperBound;
    if (suppUpper === undefined) {
      const why = e.contributors.some((c) => c.reason === 'basisUnknown') ? 'basisUnknown' : e.contributors.some((c) => c.value !== null && c.dailyAverage === null) ? 'frequencyUnknown' : 'potencyUnknown';
      reasons.push(why);
    }
    if (foodUpper === undefined) reasons.push('foodIntakeUnknown');
    const upper = suppUpper !== undefined && foodUpper !== undefined ? suppUpper + foodUpper : undefined;
    if (upper !== undefined && upper > limit.amount + 1e-9) reasons.push(e.dailyAverage === null ? 'basisUnknown' : 'foodIntakeUnknown');
    // an intermittent bolus above the daily limit is reviewed as a regimen, never cleared by its average alone
    const peakUpper = e.peakDay ?? e.peakDayUpperBound;
    if (e.intermittent && (peakUpper === undefined || peakUpper + (foodUpper ?? 0) > limit.amount + 1e-9)) reasons.push('intermittentRegimenReview');
    out.push({ ...base, status: reasons.length || upper === undefined || upper > limit.amount + 1e-9 ? 'unchecked' : 'passed', reasons: [...new Set(reasons)] });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------- per row */

export interface RowExposureStatus {
  supplementId: string | null;
  text?: string;
  /** Dose input validity is separate: a valid row may have unknown exposure. */
  doseKnown: boolean;
  /** Safety assessment of the ingredients this row contributes to (unknown potency ⇒ unchecked, never passed). */
  safetyCheck: SafetyCheckStatus;
  actives: ScheduledActive[];
  reasons: string[];
}

/**
 * Per-row exposure and safety status for the person's taking rows: `notApplicable` when no ingredient has a reference,
 * `unchecked` when potency/form/food/age leave the limit unproven, `violation` or `passed` from the aggregated
 * ingredient (all products together), so two products sharing an ingredient are judged on their sum.
 */
export function rowExposureStatuses(rows: readonly SupplementRow[], opts: { ageYears?: number; food?: Partial<Record<ExposureId, FoodIntakeBound>> } = {}): RowExposureStatus[] {
  const agg = aggregateActives(rows);
  const assess = upperLimitAssessment(agg, opts);
  const rank: Record<SafetyCheckStatus, number> = { notApplicable: 0, passed: 1, unchecked: 2, violation: 3 };
  return rows
    .filter((r) => r.state === 'taking')
    .map((row) => {
      const actives = rowActives(row);
      const doseKnown = actives.length > 0 && actives.every((a) => a.value !== null);
      let safetyCheck: SafetyCheckStatus = 'notApplicable';
      const reasons: string[] = [];
      for (const a of actives) {
        const s = assess.find((x) => x.ingredient === a.ingredient);
        if (!s) continue;
        if (rank[s.status] > rank[safetyCheck]) safetyCheck = s.status;
        reasons.push(...s.reasons);
      }
      // a recorded product with no known active identity (free text, unlabelled count) is valid but its safety unchecked
      if (actives.length === 0 && !supplementRecord(row.supplementId)) {
        safetyCheck = 'unchecked';
        reasons.push('noActiveIdentity');
      }
      return { supplementId: row.supplementId, ...(row.text ? { text: row.text } : {}), doseKnown, safetyCheck, actives, reasons: [...new Set(reasons)] };
    });
}
