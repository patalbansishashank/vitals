/**
 * Final safety evaluation of a planner option (contracts C5/C6; D4-01, D4-02, D4-03). Pure; no clock, no randomness.
 *
 *  - `resolvedExposure`: the final repaired schedule's per-day exposure channels as intervals [known lower bound, upper
 *    bound], read from the compiled schedule (the engine's own resolution: explicit and reported meals, fast suppression,
 *    refeed factors, the canonical exposure ledger with its nutrient coverage and the normalized active-ingredient doses)
 *    and, when a simulation of that schedule is given, from its recorded daily inputs (runtime maintenance references and
 *    exercise energy resolved). Unknown analysis is never a zero: complete ⇒ [sum, sum], partial ⇒ [known sum, unbounded],
 *    unknown ⇒ [0, unbounded] (A1-014); supplement actives join the legacy channels in canonical units (A1-007).
 *  - `evaluateLockConstraints`: each merged typed lock constraint (`SafetyCaps.constraints`) against that exposure with
 *    `evaluateBound` semantics: a cap passes only with a known upper bound under it, a known lower bound over it is a
 *    violation, a missing channel is `unchecked`, and a quantity without a resolved channel in a macro prescription
 *    (saturated fat, added sugar) is `unsupported`. A daily floor applies by its own source: the 17 eating-day exemption
 *    (< 800 kcal) belongs to policy/screening floors only; declared fast, zero-intake and refeed days are exempt for all
 *    (A1-008).
 *  - `evaluatePlanSafety`: those evaluations, the independent post-validator, the exercise gate with every clinician
 *    intensity maximum (D4-02/A1-003), rejected and unsupported lock definitions (A1-006) and the lock reviews/conflicts on
 *    one schedule; `optionSafetyStatus` folds in the independent safety audit (D4-03).
 *  - certificates: the fingerprint of everything a safety assurance binds (C5) — the audited subject (A1-011), the actual
 *    audit initial state/controller (A1-012) and the evaluator's audit protocol (A1-035) — and the lifecycle re-validation
 *    API that start / adopt / resume / scenario start / replan consumers call (`revalidatePlanSafety`, whose `startable` is
 *    the one authoritative, scope-aware decision); a stored proposal, a worker output or a boolean never authorizes.
 *
 * Statuses are model-scenario and policy statuses, never a probability of human safety; no clinical number is added here.
 */
import { compileSchedule } from '../../core/compileSchedule';
import { mealNutrientUnknownBits } from '../../model/safety/evaluate';
import { ENGINE_VERSION } from '../../core/defaults';
import { MODULES } from '../../core/moduleRegistry';
import { buildModelParams } from '../../core/paramsRegistry';
import type { DayExposureSummary, DayInput } from '../../types/inputs';
import type { SimulationResult } from '../../types/result';
import type { ActiveDoseSpec, CardioSession, DayTemplate, ExerciseSession, IntervalPhase, Schedule } from '../../types/schedule';
import {
  CONTRACT_FINGERPRINT,
  CONTRACT_VERSIONS,
  certificateAuthorizes,
  certificateFingerprint,
  combineConstraintStatuses,
  constraintKey,
  contentHash,
  coverageOf,
  evaluateBound,
  type Applicability,
  type CertificateInputs,
  type ChannelCoverage,
  type ConstraintCapability,
  type ConstraintConflict,
  type ConstraintDef,
  type ConstraintEvaluation,
  type ConstraintQuantity,
  type ConstraintUnit,
  type ExposureChannel,
  type IsoInstant,
  type JointScreenResult,
  type LifecycleBoundary,
  type SafetyCertificate,
  type SafetyStatus,
} from '@/lib/bodyContracts';
import { compileRequest, withHorizon, type PlanningContext } from './context';
import { mergeDay } from './dayMath';
import { generalProteinFloor, HC, type ExerciseGate, type ExerciseIntensityCap, type IntensityChannel, type LockReview } from './safety';
import { sliceSchedule } from './sensitivities';
import type { OptionSafety, PlannerRequest } from './types';
import { validatePlan, type ValidationResult } from './validate';
import { reviewExperimentalTracking, type ExperimentalTrackingReview } from './experimentalTracking';

/**
 * How each constrained quantity is checked on a resolved planner schedule (C5). `enforced`: computed from the final
 * resolved schedule / simulation; `satisfiedByConstruction`: every supported schedule source of the quantity is a known
 * zero (A1-007: a potassium supplement — proven per evaluation, else the bound is `enforced` on the actual doses), which
 * proves the bound for the prescribed scope only — never for unlogged food, products or medication; `unsupported`: no
 * resolved exposure in a macro prescription (saturated fat and added sugar need actual food composition; sodium,
 * potassium and fluids are not prescribed quantities).
 */
export const LOCK_CAPABILITY: Readonly<Record<ConstraintQuantity, ConstraintCapability>> = {
  energyPctOfMaintenance: 'enforced',
  deficitPct: 'enforced',
  fatPctEnergy: 'enforced',
  satFatPctEnergy: 'unsupported',
  addedSugarPctEnergy: 'unsupported',
  proteinPerKg: 'enforced',
  proteinPerDay: 'enforced',
  carbPerDay: 'enforced',
  caffeinePerDay: 'enforced',
  creatinePerDay: 'enforced',
  alcoholPerDay: 'enforced',
  potassiumSupplementPerDay: 'satisfiedByConstruction',
  sodiumPerDay: 'unsupported',
  potassiumPerDay: 'unsupported',
  fluidPerDay: 'unsupported',
  fastHours: 'enforced',
  stepsPerDay: 'enforced',
};

/** Rounding tolerance of a resolved value per unit (float32 series, rounded genes); not a clinical margin. */
const ROUNDING: Readonly<Record<ConstraintUnit, number>> = {
  '% of maintenance': 0.05,
  '%': 0.05,
  '%E': 0.05,
  'g/kg/d': 0.005,
  'g/d': 0.05,
  'mg/d': 0.5,
  'mL/d': 1,
  h: 1e-3,
  'steps/d': 0.5,
};

/** Floating-point tolerance of an intensity comparison (documented, not a clinical margin). */
export const INTENSITY_EPS = 1e-9;

/**
 * Per-day exposure of a resolved schedule. The plain arrays are the known value (exact when the coverage is complete) or
 * the known LOWER bound; the `…Hi` arrays are the valid UPPER bound (NaN = no valid upper bound). NaN in a plain array =
 * not resolved for that day.
 */
export interface ResolvedExposure {
  days: number;
  energyKcal: Float64Array;
  fatG: Float64Array;
  proteinG: Float64Array;
  carbG: Float64Array;
  alcoholG: Float64Array;
  caffeineMg: Float64Array;
  creatineG: Float64Array;
  /** Supplement-only elemental potassium of the schedule's sources, g/day (actives, mg/1000; A1-007). */
  potassiumSupplementGDay: Float64Array;
  fatHiG: Float64Array;
  proteinHiG: Float64Array;
  carbHiG: Float64Array;
  alcoholHiG: Float64Array;
  caffeineHiMg: Float64Array;
  creatineHiG: Float64Array;
  potassiumSupplementHiGDay: Float64Array;
  steps: Float64Array;
  /** Intake as % of the day's maintenance reference (R-MAINT). */
  energyPctMaint: Float64Array;
  /**
   * Days the 17 HC-M3/M4 policy floors apply to: 1 = an eating day of ≥ 800 kcal not touched by a fast, 0 = not
   * applicable (fast-touched, zero-intake, refeed or a low-energy day), 2 = unknown (energy unresolved). An ordinary
   * explicit meal list is never an exemption (A1-008).
   */
  floorDay: Uint8Array;
  /** Declared fast-protocol days (A1-008): touched by a compiled fast span, zero intake, or a graded refeed day. */
  fastExempt: Uint8Array;
  /** Trailing 7-day deficit, % (engine safety trace; NaN on fast-event days); null without a simulation. */
  deficitPct7: Float32Array | null;
  /** Longest zero-intake span, meal to meal, h. */
  fastHoursMax: number;
  /** Largest known daily potassium-supplement dose, g (0 when every source is a known zero). */
  potassiumSupplementG: number;
  /** Every supported potassium-supplement source of every day is a known zero (the construction proof, A1-007). */
  potassiumSupplementZeroProof: boolean;
  /** Days whose nutrient analysis is incomplete, per nutrient (A1-014; diagnostics). */
  partialNutrientDays: { protein: number; carbohydrate: number; fat: number; ethanol: number };
  /** Where the energy channels came from. */
  energySource: 'simulation' | 'compiled';
}

const nanArr = (n: number) => new Float64Array(n).fill(Number.NaN);
const MASS_TO_MG: Readonly<Record<'g' | 'mg' | 'ug', number>> = { g: 1000, mg: 1, ug: 0.001 };

type NutrientKey = 'protein' | 'carbohydrate' | 'fat' | 'fibre' | 'ethanol';
const EXPOSURE_ID: Readonly<Record<NutrientKey, string>> = { protein: 'protein', carbohydrate: 'carbAvailable', fat: 'fat', fibre: 'fibre', ethanol: 'ethanol' };
/** `NUTRIENT_UNKNOWN_BIT` of the engine contract (A1-014), read structurally. */
const UNKNOWN_BIT: Readonly<Record<NutrientKey, number>> = { protein: 1, carbohydrate: 2, fat: 4, fibre: 8, ethanol: 16 };
const RANK: Readonly<Record<'complete' | 'partial' | 'unknown', number>> = { complete: 2, partial: 1, unknown: 0 };

/**
 * Nutrient coverage a day's explicit meals allow (A1-014), independently of the compiler's ledger (`mealNutrientUnknownBits`:
 * a reported-energy meal states only the grams it lists, a non-'known' `nutrientKnowledge` is not a known amount, a
 * share-filled gram on a reported day is a scenario fill). Other days are the prescription's own construction (complete).
 */
function templateNutrientCoverage(t: DayTemplate, key: NutrientKey): 'complete' | 'partial' {
  return (mealNutrientUnknownBits(t) & UNKNOWN_BIT[key]) !== 0 ? 'partial' : 'complete';
}

/**
 * Interval of one nutrient on a day whose analysis is incomplete (A1-014): the ledger's known contributions are the lower
 * bound (on an observed day they exclude the imputed remainder; on a prescribed day with reported meals they are the
 * known grams, the absent ones being compatibility zeros), the upper bound is unbounded unless the ledger carries a
 * supported tighter bound. A ledger that knows nothing contributes 0.
 */
function incompleteInterval(s: DayExposureSummary | undefined): [number, number] {
  const ext = s as (DayExposureSummary & { lowerBound?: number; upperBound?: number | null }) | undefined;
  const ledger = coverageClass(s?.coverage);
  const known = s && ledger !== 'unknown' && Number.isFinite(s.knownSum) && s.knownSum > 0 ? s.knownSum : 0;
  const lo = ext?.lowerBound !== undefined && Number.isFinite(ext.lowerBound) ? Math.max(ext.lowerBound, known) : known;
  const hi = ext?.upperBound !== undefined && ext.upperBound !== null && Number.isFinite(ext.upperBound) && ext.upperBound >= lo ? ext.upperBound : Number.NaN;
  return [lo, hi];
}

/** The coverage word of a compiled summary for interval purposes. */
function coverageClass(c: ChannelCoverage | undefined): 'complete' | 'partial' | 'unknown' {
  if (c === 'complete' || c === 'confirmedZero') return 'complete';
  if (c === 'partial') return 'partial';
  return 'unknown';
}

/** Coverage of a supplement/caffeine channel on a day: prescriptions state their own doses; observed days carry theirs. */
function channelCoverage(t: DayTemplate, channel: ExposureChannel): 'complete' | 'partial' | 'unknown' {
  const obs = t.observed;
  if (!obs) return 'complete';
  return coverageClass(coverageOf(obs.coverage, channel));
}

/**
 * Sum of one ingredient across the legacy channel and the normalized actives of a day (A1-007), mass in `unit`. Doses
 * that share an explicit event identity are one exposure; doses that cannot be told apart (one side without identity)
 * may coincide, so the day's interval is [max(legacy, actives), legacy + actives] — never an unconditional sum.
 */
function ingredientInterval(
  legacy: ReadonlyArray<{ amount: number; eventId?: string }>,
  actives: readonly ActiveDoseSpec[] | undefined,
  ingredient: string,
  toUnit: (mg: number) => number,
  legacyCoverage: 'complete' | 'partial' | 'unknown',
  activeCoverage: 'complete' | 'partial' | 'unknown',
): { lo: number; hi: number; any: boolean } {
  const legIds = new Set(legacy.map((l) => l.eventId).filter((x): x is string => !!x));
  let sumL = 0;
  let legacyNoId = false;
  for (const l of legacy) {
    if (!(l.amount > 0)) continue;
    sumL += l.amount;
    if (!l.eventId) legacyNoId = true;
  }
  let sumA = 0;
  let activesNoId = false;
  let anyA = false;
  let molar = false;
  for (const a of actives ?? []) {
    if (a.ingredient !== ingredient || !Number.isFinite(a.amount) || a.amount < 0) continue;
    if (a.eventId && legIds.has(a.eventId)) continue; // the same event: one exposure, counted once (legacy side)
    if (a.unit === 'mmol') {
      molar = true; // a molar dose has no declared mass conversion here: unknown amount, never zero
      continue;
    }
    anyA = true;
    sumA += toUnit(a.amount * MASS_TO_MG[a.unit]);
    if (!a.eventId) activesNoId = true;
  }
  const ambiguous = sumL > 0 && sumA > 0 && (legacyNoId || activesNoId);
  let lo = ambiguous ? Math.max(sumL, sumA) : sumL + sumA;
  let hi = sumL + sumA;
  if (legacyCoverage !== 'complete' || activeCoverage !== 'complete' || molar) hi = Number.NaN;
  if (!Number.isFinite(lo)) lo = 0;
  return { lo, hi, any: sumL > 0 || anyA || molar };
}

/**
 * Resolved exposure of a final schedule. The compiled schedule resolves static days, meal overrides, reported meals, fast
 * suppression and refeed factors and carries the canonical exposure ledger; a simulation of the same schedule (when given)
 * supplies the runtime-resolved daily inputs of channels whose analysis is complete. With `simDayOffset` the simulation
 * started `simDayOffset` days before the schedule's day 0 (a re-plan's future slice judged on the whole-plan run).
 */
export function resolvedExposure(ctx: PlanningContext, schedule: Schedule, sim?: SimulationResult | null, simDayOffset = 0): ResolvedExposure {
  const cs = compileSchedule(schedule, ctx.rp, { exposure: true });
  const T = cs.nDays;
  const x: ResolvedExposure = {
    days: T,
    energyKcal: nanArr(T),
    fatG: nanArr(T),
    proteinG: nanArr(T),
    carbG: nanArr(T),
    alcoholG: nanArr(T),
    caffeineMg: nanArr(T),
    creatineG: nanArr(T),
    potassiumSupplementGDay: nanArr(T),
    fatHiG: nanArr(T),
    proteinHiG: nanArr(T),
    carbHiG: nanArr(T),
    alcoholHiG: nanArr(T),
    caffeineHiMg: nanArr(T),
    creatineHiG: nanArr(T),
    potassiumSupplementHiGDay: nanArr(T),
    steps: nanArr(T),
    energyPctMaint: nanArr(T),
    floorDay: new Uint8Array(T),
    fastExempt: new Uint8Array(T),
    deficitPct7: sim?.safety?.deficitPct7 ? (simDayOffset > 0 ? sim.safety.deficitPct7.subarray(simDayOffset) : sim.safety.deficitPct7) : null,
    fastHoursMax: 0,
    potassiumSupplementG: 0,
    potassiumSupplementZeroProof: true,
    partialNutrientDays: { protein: 0, carbohydrate: 0, fat: 0, ethanol: 0 },
    energySource: sim ? 'simulation' : 'compiled',
  };
  const touched = new Uint8Array(T);
  for (const sp of cs.fastSpans) {
    const h = sp.mealToMealH ?? sp.endHour - sp.startHour;
    if (Number.isFinite(h)) x.fastHoursMax = Math.max(x.fastHoursMax, h);
    for (let d = Math.max(0, Math.floor(sp.startHour / 24)); d <= Math.min(T - 1, Math.floor((sp.endHour - 1e-9) / 24)); d++) touched[d] = 1;
  }
  const daily = sim?.daily;
  const pick = (id: 'inEnergy' | 'inFat' | 'inProtein' | 'inCarbs' | 'inAlcohol' | 'inSteps' | 'inEnergyPctMaint', d: number, fallback: number): number => {
    const a = daily?.[id];
    const i = d + simDayOffset;
    const v = a && i < a.length ? a[i]! : Number.NaN;
    return Number.isFinite(v) ? v : fallback;
  };
  const nutrient = (di: DayInput, t: DayTemplate, key: NutrientKey, exact: number): [number, number] => {
    const s = di.exposure?.[EXPOSURE_ID[key]];
    // no ledger at all (a compiler without the exposure pass): a prescription day is its own construction, an observed
    // day is unknown; a ledger without this nutrient is unknown
    const fromLedger = di.exposure ? coverageClass(s?.coverage) : t.observed ? 'unknown' : 'complete';
    const fromMask = ((di as { nutrientUnknownMask?: number }).nutrientUnknownMask ?? 0) & UNKNOWN_BIT[key] ? 'partial' : 'complete';
    const fromMeals = templateNutrientCoverage(t, key);
    // the strictest of the compiler ledger, the compiler's per-meal mask and the meal specs themselves
    let cov = fromLedger;
    if (RANK[fromMask] < RANK[cov]) cov = fromMask;
    if (RANK[fromMeals] < RANK[cov]) cov = fromMeals;
    if (s?.coverage === 'confirmedZero') return [0, 0];
    if (cov !== 'complete') {
      if (key !== 'fibre') x.partialNutrientDays[key as 'protein']++;
      return incompleteInterval(s);
    }
    return [exact, exact];
  };
  for (let d = 0; d < T; d++) {
    const di = cs.days[d]!;
    const t = mergeDay(schedule.programs[schedule.days[d]!.program]!, schedule.days[d]!.override);
    const compiledPct = di.energyMode === 'zero' ? 0 : Number.isFinite(di.maintenanceKcal) && di.maintenanceKcal > 0 ? (100 * di.energyKcal) / di.maintenanceKcal : Number.NaN;
    x.energyKcal[d] = pick('inEnergy', d, di.energyKcal);
    const [fLo, fHi] = nutrient(di, t, 'fat', pick('inFat', d, di.fatG));
    const [pLo, pHi] = nutrient(di, t, 'protein', pick('inProtein', d, di.proteinG));
    const [cLo, cHi] = nutrient(di, t, 'carbohydrate', pick('inCarbs', d, di.carbG));
    const [aLo, aHi] = nutrient(di, t, 'ethanol', pick('inAlcohol', d, di.alcoholG));
    x.fatG[d] = fLo;
    x.fatHiG[d] = fHi;
    x.proteinG[d] = pLo;
    x.proteinHiG[d] = pHi;
    x.carbG[d] = cLo;
    x.carbHiG[d] = cHi;
    x.alcoholG[d] = aLo;
    x.alcoholHiG[d] = aHi;
    x.steps[d] = pick('inSteps', d, di.steps);
    x.energyPctMaint[d] = pick('inEnergyPctMaint', d, compiledPct);
    // (A1-007) supplement and caffeine sources: the legacy channels (compiled) and the normalized actives, canonical units
    const actives = t.substances?.actives;
    const supCov = channelCoverage(t, 'supplements');
    const legacyCaf = t.substances?.caffeine ? t.substances.caffeine.map((c) => ({ amount: c.mg, ...(c.eventId ? { eventId: c.eventId } : {}) })) : di.caffeineMg > 0 ? [{ amount: di.caffeineMg }] : [];
    const caf = ingredientInterval(legacyCaf, actives, 'caffeine', (mg) => mg, channelCoverage(t, 'caffeine'), supCov);
    x.caffeineMg[d] = caf.lo;
    x.caffeineHiMg[d] = caf.hi;
    const cre = ingredientInterval(di.creatineG > 0 ? [{ amount: di.creatineG }] : [], actives, 'creatine', (mg) => mg / 1000, supCov, supCov);
    x.creatineG[d] = cre.lo;
    x.creatineHiG[d] = cre.hi;
    const pot = ingredientInterval([], actives, 'potassium', (mg) => mg / 1000, supCov, supCov);
    x.potassiumSupplementGDay[d] = pot.lo;
    x.potassiumSupplementHiGDay[d] = pot.hi;
    if (pot.any || !(pot.hi === 0)) x.potassiumSupplementZeroProof = false;
    if (pot.lo > x.potassiumSupplementG) x.potassiumSupplementG = pot.lo;
    // (A1-008) applicability from actual compiled fast spans, zero intake and graded refeed factors; an ordinary explicit
    // meal list is not a shortened day
    const fastDay = touched[d] === 1 || di.zeroIntake || (di.refeedFactor ?? 1) < 1;
    x.fastExempt[d] = fastDay ? 1 : 0;
    const E = x.energyKcal[d]!;
    x.floorDay[d] = fastDay ? 0 : !Number.isFinite(E) ? 2 : E >= HC.fat.appliesAboveKcal ? 1 : 0;
  }
  return x;
}

/**
 * Interval [lower, upper] of the worst day of a per-day quantity for a cap (max) or a floor (min) from per-day intervals
 * [lo_d, hi_d] (NaN lo = unresolved day, NaN hi = no upper bound). A cap's worst day is bounded below by the largest
 * known lower bound and above only when every day has an upper bound; a floor's below only when every day is resolved
 * and above by the smallest known upper bound.
 */
function worstOver(n: number, lo: (d: number) => number, hi: (d: number) => number, comparator: 'cap' | 'floor', include: (d: number) => boolean): { lower: number | null; upper: number | null; applicable: boolean } {
  let applicable = false;
  let maxLo = -Infinity;
  let maxHi = -Infinity;
  let minLo = Infinity;
  let minHi = Infinity;
  let loMissing = false;
  let hiMissing = false;
  for (let d = 0; d < n; d++) {
    if (!include(d)) continue;
    applicable = true;
    const l = lo(d);
    const h = hi(d);
    if (Number.isFinite(l)) {
      if (l > maxLo) maxLo = l;
      if (l < minLo) minLo = l;
    } else loMissing = true;
    if (Number.isFinite(h)) {
      if (h > maxHi) maxHi = h;
      if (h < minHi) minHi = h;
    } else hiMissing = true;
  }
  if (!applicable) return { lower: null, upper: null, applicable };
  if (comparator === 'cap') return { lower: Number.isFinite(maxLo) ? maxLo : null, upper: hiMissing || !Number.isFinite(maxHi) ? null : maxHi, applicable };
  return { lower: loMissing || !Number.isFinite(minLo) ? null : minLo, upper: Number.isFinite(minHi) ? minHi : null, applicable };
}

/** Whether a floor's own semantics include the 17 eating-day exemption (< 800 kcal): policy and screening floors only. */
const policyFloor = (def: ConstraintDef): boolean => def.source.kind === 'policy' || def.source.kind === 'screening';

/** Evaluate one typed constraint on a resolved exposure (C5 `evaluateBound` semantics, units of the constraint). */
export function evaluateConstraint(def: ConstraintDef, x: ResolvedExposure, ctx: Pick<PlanningContext, 'caps'>): ConstraintEvaluation {
  let capability = LOCK_CAPABILITY[def.quantity];
  if (def.quantity === 'potassiumSupplementPerDay' && !x.potassiumSupplementZeroProof) capability = 'enforced';
  const base = { constraintId: def.id, key: constraintKey(def), capability, mandatory: def.mandatory, unit: def.unit };
  if (def.applicability === 'notApplicable') return { ...base, status: 'notApplicable', margin: null, reasonCode: 'notApplicable' };
  if (def.applicability !== 'applicable') return { ...base, status: 'unchecked', margin: null, reasonCode: 'unresolvedApplicability' };
  if ((def.quantity === 'proteinPerDay' || def.quantity === 'proteinPerKg') && def.scope !== 'total') return { ...base, status: 'unchecked', margin: null, reasonCode: 'unsupportedScope' };
  if (def.window.kind !== 'day' && def.window.kind !== 'rolling' && def.quantity !== 'fastHours') return { ...base, status: 'unchecked', margin: null, reasonCode: 'unsupportedWindow' };
  if (capability === 'unsupported') return { ...base, status: 'unchecked', margin: null, reasonCode: 'noResolvedChannel' };
  const all = () => true;
  const isFloor = def.comparator === 'floor';
  // (A1-008) a floor applies on its own days: policy/screening floors on 17 eating days (an eating day whose energy is
  // unknown counts as unresolved, never as a pass), any other floor on every day except declared fast-protocol days
  const floorDays = !isFloor ? all : policyFloor(def) ? (d: number) => x.floorDay[d] !== 0 : (d: number) => x.fastExempt[d] === 0;
  const unresolvedFloorDay = (d: number) => isFloor && policyFloor(def) && x.floorDay[d] === 2;
  const perDay = (lo: (d: number) => number, hi: (d: number) => number, include: (d: number) => boolean = all) => {
    if (def.window.kind !== 'rolling') return worstOver(x.days, (d) => unresolvedFloorDay(d) ? Number.NaN : lo(d), (d) => unresolvedFloorDay(d) ? Number.NaN : hi(d), def.comparator, include);
    const n = def.window.days;
    if (n > x.days) return { lower: null, upper: null, applicable: true };
    const mean = (end: number, read: (d: number) => number) => {
      let sum = 0;
      for (let d = end - n + 1; d <= end; d++) { if (unresolvedFloorDay(d)) return Number.NaN; sum += read(d); }
      return sum / n;
    };
    return worstOver(x.days, (d) => mean(d, lo), (d) => mean(d, hi), def.comparator, (d) => d >= n - 1 && Array.from({ length: n }, (_, j) => d - j).every(include));
  };
  let exp: { lower: number | null; upper: number | null; applicable: boolean };
  let reason = 'ok';
  switch (def.quantity) {
    case 'fatPctEnergy': {
      // 100·9·fat g / resolved energy kcal; a zero-energy day is not a 0 % day (not applicable)
      const pos = (d: number) => !(x.energyKcal[d]! <= 0);
      exp = perDay((d) => (900 * x.fatG[d]!) / x.energyKcal[d]!, (d) => (900 * x.fatHiG[d]!) / x.energyKcal[d]!, (d) => pos(d) && floorDays(d));
      break;
    }
    case 'energyPctOfMaintenance':
      exp = perDay((d) => x.energyPctMaint[d]!, (d) => x.energyPctMaint[d]!);
      break;
    case 'deficitPct':
      if (!x.deficitPct7) {
        exp = { lower: null, upper: null, applicable: true };
        reason = 'needsSimulation';
      } else {
        const a = x.deficitPct7;
        // fast-event days are NaN in the engine trace (their 28-day leg is a separate margin): skipped, not unresolved
        exp = perDay((d) => a[d]!, (d) => a[d]!, (d) => Number.isFinite(a[d]!));
      }
      break;
    case 'proteinPerKg': {
      const rw = ctx.caps.rwKg;
      exp = perDay((d) => x.proteinG[d]! / rw, (d) => x.proteinHiG[d]! / rw, floorDays);
      break;
    }
    case 'proteinPerDay':
      exp = perDay((d) => x.proteinG[d]!, (d) => x.proteinHiG[d]!, floorDays);
      break;
    case 'carbPerDay':
      exp = perDay((d) => x.carbG[d]!, (d) => x.carbHiG[d]!, floorDays);
      break;
    case 'caffeinePerDay':
      exp = perDay((d) => x.caffeineMg[d]!, (d) => x.caffeineHiMg[d]!);
      break;
    case 'creatinePerDay':
      exp = perDay((d) => x.creatineG[d]!, (d) => x.creatineHiG[d]!);
      break;
    case 'alcoholPerDay':
      exp = perDay((d) => x.alcoholG[d]!, (d) => x.alcoholHiG[d]!);
      break;
    case 'potassiumSupplementPerDay':
      // the supplement-only scope: every schedule source in canonical g/day; zero only with the construction proof
      exp = x.potassiumSupplementZeroProof ? { lower: 0, upper: 0, applicable: true } : perDay((d) => x.potassiumSupplementGDay[d]!, (d) => x.potassiumSupplementHiGDay[d]!);
      reason = x.potassiumSupplementZeroProof ? 'prescribedScopeOnly' : 'ok';
      break;
    case 'fastHours':
      exp = { lower: x.fastHoursMax, upper: x.fastHoursMax, applicable: true };
      break;
    case 'stepsPerDay':
      exp = perDay((d) => x.steps[d]!, (d) => x.steps[d]!);
      break;
    default:
      return { ...base, status: 'unchecked', margin: null, reasonCode: 'noResolvedChannel' };
  }
  const applicability: Applicability = !exp.applicable ? 'notApplicable' : def.applicability;
  const tol = ROUNDING[def.unit];
  const shift = (v: number | null) => (v === null ? null : def.comparator === 'cap' ? v - tol : v + tol);
  const r = evaluateBound(def, { lower: shift(exp.lower), upper: shift(exp.upper) }, applicability);
  return { ...base, status: r.status, margin: r.margin, reasonCode: r.status === 'unchecked' && reason === 'ok' ? (exp.upper === null && exp.lower !== null ? 'lowerBoundOnly' : 'unresolvedChannel') : reason };
}

/** Typed lock constraints of a context evaluated on a resolved exposure (the HC-M3 policy floor only detects conflicts). */
export function evaluateLockConstraints(ctx: PlanningContext, x: ResolvedExposure): ConstraintEvaluation[] {
  return (ctx.caps.constraints.definitions ?? ctx.caps.constraints.merged).filter((d) => d.id !== 'HC-M3').map((d) => evaluateConstraint(d, x, ctx));
}

// ------------------------------------------------------------------------------------------------ exercise intensity (A1-003)

/** One clinician intensity maximum checked on the final schedule. */
export interface IntensityCheck {
  envelopeId: string;
  /** The entered limit and its normalized comparable value (A1-003: both retained). */
  original: ExerciseIntensityCap['original'];
  normalized: ExerciseIntensityCap['normalized'];
  /** 'pass': every applicable part is at or below it; 'violation': a part above it; 'unchecked': a session or part with no comparable stated dose; 'review': the limit itself cannot be read; 'notApplicable': no session. */
  status: 'pass' | 'violation' | 'unchecked' | 'review' | 'notApplicable';
  reasonCode: string;
  /** Peak comparable value found and its day (1-based), when any. */
  peak: number | null;
  day: number | null;
}

/** A part of a session at one intensity: the stated value on `channel`, or null when not stated / not comparable. */
function phaseValue(src: { pctVo2max?: number; met?: number; rpe?: number }, scale: string | undefined, channel: IntensityChannel): number | null {
  const v = channel === 'pctVo2maxFraction' ? src.pctVo2max : channel === 'grossMet' ? src.met : scale === 'cr10' ? src.rpe : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

const phaseHasIntensity = (ph: IntervalPhase): boolean => ph.pctVo2max !== undefined || ph.met !== undefined || ph.rpe !== undefined || ph.speedKmh !== undefined || ph.powerW !== undefined;

/**
 * Comparable intensities of every applicable part of a session (A1-003): each interval phase with its own descriptors, a
 * phase without them at the session's, the time past the last phase at the session's; a 'remainder' phase has no
 * intensity (null). A resistance session is comparable only by a stated gross MET. Null = not comparable for that part.
 */
export function resolvedSessionIntensities(s: ExerciseSession, channel: IntensityChannel): Array<number | null> {
  if (s.kind === 'resistance') return [channel === 'grossMet' && typeof s.met === 'number' && Number.isFinite(s.met) ? s.met : null];
  const c = s as CardioSession;
  const sessionScale = (c as { rpeScale?: string }).rpeScale;
  const own = phaseValue(c, sessionScale, channel);
  const phases = c.phases ?? [];
  if (!phases.length) return [own];
  const out: Array<number | null> = [];
  let booked = 0;
  for (const ph of phases) {
    booked += Math.max(0, ph.durationMin);
    if ((ph.kind as string) === 'remainder') {
      out.push(null);
      continue;
    }
    const phScale = (ph as { rpeScale?: string }).rpeScale ?? sessionScale;
    out.push(phaseHasIntensity(ph) ? phaseValue(ph, phScale, channel) : own);
  }
  if (booked < c.durationMin - 1e-9) out.push(own);
  return out;
}

/** Check every clinician intensity maximum on the final schedule from day `fromDay` (peak part, never a session mean). */
export function checkIntensityCaps(caps: readonly ExerciseIntensityCap[], schedule: Schedule): IntensityCheck[] {
  const out: IntensityCheck[] = [];
  for (const cap of caps) {
    const base = { envelopeId: cap.envelopeId, original: cap.original, normalized: cap.normalized };
    if (cap.status === 'unknownUnit' || cap.status === 'invalidValue') {
      out.push({ ...base, status: 'review', reasonCode: cap.status, peak: null, day: null });
      continue;
    }
    let any = false;
    let peak: number | null = null;
    let peakDay: number | null = null;
    let notComparable: string | null = null;
    for (let d = 0; d < schedule.horizonDays; d++) {
      const t = mergeDay(schedule.programs[schedule.days[d]!.program]!, schedule.days[d]!.override);
      const sessions = t.exercise ?? [];
      if (t.habitualTraining) {
        any = true;
        notComparable ??= 'habitualTrainingIntensityUnknown';
      }
      for (const s of sessions) {
        any = true;
        if (!cap.normalized) {
          notComparable ??= 'noComparableChannel';
          continue;
        }
        for (const v of resolvedSessionIntensities(s, cap.normalized.channel)) {
          if (v === null) {
            notComparable ??= s.kind === 'resistance' ? 'resistanceNotComparable' : 'intensityNotStated';
            continue;
          }
          if (peak === null || v > peak) {
            peak = v;
            peakDay = d + 1;
          }
        }
      }
    }
    if (!any) {
      out.push({ ...base, status: 'notApplicable', reasonCode: 'noSessions', peak: null, day: null });
      continue;
    }
    // a known part above the maximum is a violation whatever else is unknown; a pass needs every part comparable
    if (cap.normalized && peak !== null && peak > cap.normalized.max + INTENSITY_EPS) out.push({ ...base, status: 'violation', reasonCode: 'aboveClinicianMaximum', peak, day: peakDay });
    else if (notComparable) out.push({ ...base, status: 'unchecked', reasonCode: notComparable, peak, day: peakDay });
    else out.push({ ...base, status: 'pass', reasonCode: 'ok', peak, day: peakDay });
  }
  return out;
}

/** The exercise gate (D4-02) checked on the final schedule: no sessions or "training as usual", steps ≤ the ceiling, every clinician intensity maximum. */
export function checkExerciseGate(ctx: PlanningContext, schedule: Schedule, x?: ResolvedExposure): { gate: ExerciseGate; ok: boolean; reasons: string[]; intensity: IntensityCheck[] } {
  const e = ctx.caps.exercise;
  const reasons: string[] = [];
  const T = schedule.horizonDays;
  // (A1-004) from the day the governing envelope's entered review date passes (or it is withdrawn) the gate holds again
  const change = e.gateChange ?? null;
  const habit = Math.max(0, ctx.rp.habits.typicalSteps);
  for (let d = 0; d < T && reasons.length < 10; d++) {
    const t = mergeDay(schedule.programs[schedule.days[d]!.program]!, schedule.days[d]!.override);
    const lapsed = change !== null && d >= change.day;
    for (const s of t.exercise ?? []) {
      if (lapsed) reasons.push(`${s.kind} session on day ${d + 1} after the clinician review date ${change.date}`);
      else if (s.kind === 'resistance' && !e.rtAllowed) reasons.push(`resistance session on day ${d + 1}`);
      else if (s.kind === 'cardio' && !e.cardioAllowed) reasons.push(`cardio session on day ${d + 1}`);
    }
    if (t.habitualTraining && (lapsed || !e.habitualTrainingAllowed)) reasons.push(`training as usual on day ${d + 1}`);
    const steps = x ? x.steps[d]! : t.steps;
    const ceiling = lapsed ? habit : e.stepsCeiling;
    if (ceiling !== null && steps !== undefined && Number.isFinite(steps) && steps > ceiling + ROUNDING['steps/d']) reasons.push(`steps above ${Math.round(ceiling)} on day ${d + 1}`);
  }
  const intensity = checkIntensityCaps(e.intensityCaps ?? [], schedule);
  for (const c of intensity) {
    if (c.status !== 'violation' || reasons.length >= 10) continue;
    const n = c.normalized!;
    const shown = n.channel === 'pctVo2maxFraction' ? `${Math.round(1000 * c.peak!) / 10} % VO2max (limit ${Math.round(1000 * n.max) / 10} %)` : `${c.peak} ${n.channel === 'grossMet' ? 'MET' : 'CR-10'} (limit ${n.max})`;
    reasons.push(`intensity ${shown} on day ${c.day}`);
  }
  return { gate: e.gate, ok: reasons.length === 0, reasons, intensity };
}

/** A lock definition that failed validation, as supplied (A1-006). */
export interface RejectedConstraint {
  constraintId: string;
  reason: string;
  value: number;
  unit: string;
  mandatory: boolean;
  source: ConstraintDef['source']['kind'];
}

/** Everything the final check of one schedule found (before the independent safety audit). */
export interface PlanSafetyEvaluation {
  evaluations: ConstraintEvaluation[];
  conflicts: ConstraintConflict[];
  review: LockReview[];
  /** (A1-006) Definitions rejected by validation (negative, non-finite, unknown unit…), original values kept. */
  rejected: RejectedConstraint[];
  validator: ValidationResult;
  exercise: { gate: ExerciseGate; ok: boolean; reasons: string[]; intensity: IntensityCheck[] };
  /** Status of the constraint checks alone (no audit). */
  status: SafetyStatus;
}

/** All comparable protein sources in g/day, retaining each definition's source and original clinical entry in caps. */
function proteinDefinitions(ctx: PlanningContext): ConstraintDef[] {
  const defs = (ctx.caps.constraints.definitions ?? ctx.caps.constraints.merged).flatMap((d) => {
    if (d.quantity === 'proteinPerDay') return [d];
    if (d.quantity !== 'proteinPerKg') return [];
    const kg = d.basis === 'reference' ? ctx.caps.rwKg : d.basis === 'actual' ? ctx.caps.weightKg : d.basis === 'ffm' ? ctx.caps.ffmKg : null;
    return kg === null ? [] : [{ ...d, quantity: 'proteinPerDay' as const, unit: 'g/d' as const, basis: 'notApplicable' as const, value: d.value * kg }];
  });
  if (ctx.caps.renal.withheld.includes('protein') && ctx.caps.renal.habitualProteinG !== null) {
    const routine: ConstraintDef = { id: 'renal.documentedRoutine', quantity: 'proteinPerDay', unit: 'g/d', comparator: 'cap', value: ctx.caps.renal.habitualProteinG, basis: 'notApplicable', scope: 'total', window: { kind: 'day' }, applicability: 'applicable', mandatory: true, source: { kind: 'user', ref: 'habits.habitualProteinGPerKg' }, policyVersion: CONTRACT_VERSIONS.constraintPolicy };
    defs.push(routine);
  }
  return defs;

}

/** The actual trailing exposure selects the general floor before any clinical intersection. */
function finalProteinRequirements(ctx: PlanningContext, x: ResolvedExposure): { evaluations: ConstraintEvaluation[]; conflicts: ConstraintConflict[] } {
  const evaluations: ConstraintEvaluation[] = [];
  const conflicts: ConstraintConflict[] = [];
  const defs = proteinDefinitions(ctx).filter((d) => d.applicability === 'applicable' && d.scope === 'total');
  const caps = defs.filter((d) => d.comparator === 'cap');
  const general: Array<ConstraintDef | null> = [];
  for (let day = 0; day < x.days; day++) {
    if (x.fastExempt[day] || x.energyKcal[day]! < ctx.caps.restrictedDayUpperKcal) { general.push(null); continue; }
    let pct = 0;
    const start = Math.max(0, day - 6);
    for (let d = start; d <= day; d++) pct += x.energyPctMaint[d]!;
    const deficit = x.deficitPct7 && Number.isFinite(x.deficitPct7[day]) ? x.deficitPct7[day]! : 100 - pct / (day - start + 1);
    const floor = generalProteinFloor(ctx.caps, deficit);
    general.push(floor);
    const r = evaluateBound(floor, { lower: Number.isFinite(x.proteinG[day]) ? x.proteinG[day]! + ROUNDING['g/d'] : null, upper: Number.isFinite(x.proteinHiG[day]) ? x.proteinHiG[day]! + ROUNDING['g/d'] : null });
    evaluations.push({ constraintId: floor.id, key: `${constraintKey(floor)}|day:${day}`, capability: 'enforced', mandatory: true, unit: 'g/d', status: r.status, margin: r.margin, reasonCode: 'resolvedGeneralFloor' });
  }
  for (const cap of caps) {
    if (cap.window.kind !== 'day' && cap.window.kind !== 'rolling') continue;
    const n = cap.window.kind === 'rolling' ? cap.window.days : 1;
    for (let end = n - 1; end < x.days; end++) {
      const required = general.slice(end - n + 1, end + 1);
      if (required.some((d) => d === null)) continue;
      const mean = required.reduce((sum, d) => sum + d!.value, 0) / n;
      if (mean > cap.value + ROUNDING['g/d']) {
        const floor = { ...required[0]!, value: mean, window: cap.window };
        if (!conflicts.some((c) => c.cap.id === cap.id && c.floor.id === floor.id && c.cap.source.ref === cap.source.ref)) conflicts.push({ key: constraintKey(cap), cap, floor });
      }
    }
  }
  // Cross-basis clinical/marker requirements compare only within their declared exposure window and scope.
  for (const cap of caps) for (const floor of defs.filter((d) => d.comparator === 'floor')) {
    if (constraintKey(cap) === constraintKey(floor) && floor.value > cap.value + ROUNDING['g/d']) conflicts.push({ key: constraintKey(cap), cap, floor });
  }
  return { evaluations, conflicts };
}

/** Unknown/stale authority is scoped to actual new numbers; documented routine is independently retained. */
function renalAuthorityReviews(ctx: PlanningContext, schedule: Schedule, x: ResolvedExposure): LockReview[] {
  const renal = ctx.caps.renal;
  const reviews: LockReview[] = [];
  for (const b of renal.clinical.bounds) {
    if (!b.def.mandatory || b.status === 'enforceable' || b.status === 'notApplicable' || b.status === 'invalid') continue;
    if (b.reason?.split(',').every((r) => ['revoked', 'notYetAssessed'].includes(r))) continue;
    const originalEnvelope = renal.clinical.envelopes.find((e) => e.id === b.envelopeId);
    const datedReview = b.reason?.split(',').every((r) => ['medicationChanged', 'acuteIllness', 'newClinicalFinding', 'reviewDatePassed'].includes(r));
    if (datedReview && originalEnvelope?.condition === 'ckd' && !renal.withheld.includes(b.domain ?? 'protein') && renal.clinical.applicable.some((e) => e.condition === 'ckd' && e.assessedAt > originalEnvelope.assessedAt && renal.clinical.bounds.some((replacement) => replacement.envelopeId === e.id && replacement.domain === b.domain && replacement.status === 'enforceable'))) continue;

    // A previously assessed protein instruction may allow an unchanged documented routine, but no changed target.
    if (b.domain === 'protein' && renal.habitualProteinG !== null && x.proteinG.every((g) => Math.abs(g - renal.habitualProteinG!) <= ROUNDING['g/d'])) continue;
    reviews.push({ id: b.def.id, status: 'review', reason: b.reason ?? 'clinicalApplicabilityUnresolved', mandatory: true, source: b.def.source.kind, value: b.def.value, unit: b.def.unit });
  }
  if (renal.withheld.includes('protein')) {
    const held = renal.habitualProteinG;
    if (held === null || x.proteinG.some((g, d) => !Number.isFinite(g) || !Number.isFinite(x.proteinHiG[d]) || Math.abs(g - held) > ROUNDING['g/d']))
      reviews.push({ id: 'renal.protein.authority', status: 'review', reason: held === null ? 'habitualProteinUndocumented' : 'changedWithoutAuthority', mandatory: true, source: 'policy' });
  }
  for (let day = 0; day < schedule.horizonDays; day++) {
    const t = mergeDay(schedule.programs[schedule.days[day]!.program]!, schedule.days[day]!.override);
    const sodiumChanged = t.hydration?.sodiumG !== undefined && (renal.habitualProvenance.sodium === null || Math.abs(t.hydration.sodiumG - renal.habitualProvenance.sodium.value) > ROUNDING['mg/d'] / 1000);
    if ((renal.withheld.includes('sodium') && sodiumChanged) || (renal.withheld.includes('fluid') && t.hydration?.fluidL !== undefined) || (renal.withheld.includes('potassium') && t.hydration?.electrolytes)) {
      reviews.push({ id: 'renal.hydration.authority', status: 'review', reason: 'changedWithoutDomainAuthority', mandatory: true, source: 'policy' });
      break;
    }
  }
  return reviews;
}

/**
 * Final check of one resolved schedule (C5/D4-01, D4-02): typed lock evaluations, the independent post-validator, the
 * exercise gate and the lock reviews / conflicts / rejected definitions. `sim` (a simulation of exactly this schedule, or
 * of the whole plan started `simDayOffset` days earlier) resolves runtime days; `elapsedDays` places a re-plan's slice in
 * the plan's weeks.
 */
export function evaluatePlanSafety(ctx: PlanningContext, schedule: Schedule, sim?: SimulationResult | null, opts: { simDayOffset?: number; elapsedDays?: number } = {}): PlanSafetyEvaluation {
  const x = resolvedExposure(ctx, schedule, sim, opts.simDayOffset ?? 0);
  const protein = finalProteinRequirements(ctx, x);
  const evaluations = [...evaluateLockConstraints(ctx, x), ...protein.evaluations];
  const validator = validatePlan(ctx, schedule, { elapsedDays: opts.elapsedDays ?? 0 });
  const exercise = checkExerciseGate(ctx, schedule, x);
  const conflicts = [...ctx.caps.constraints.conflicts, ...protein.conflicts];
  const review = [...ctx.caps.constraints.review, ...renalAuthorityReviews(ctx, schedule, x)];
  const rejected: RejectedConstraint[] = ctx.caps.constraints.rejected.map((r) => ({
    constraintId: r.def.id,
    reason: r.reason,
    value: r.def.value,
    unit: r.def.unit,
    mandatory: r.def.mandatory,
    source: r.def.source.kind,
  }));
  return { evaluations, conflicts, review, rejected, validator, exercise, status: constraintStatusOf({ evaluations, conflicts, review, rejected, validator, exercise }) };
}

function constraintStatusOf(e: Omit<PlanSafetyEvaluation, 'status'>): SafetyStatus {
  // a known violation is kept whatever else is unresolved (A1-006: also beside rejected or unsupported definitions)
  if (!e.validator.ok || !e.exercise.ok || e.evaluations.some((v) => v.status === 'violation')) return 'violation';
  if (e.conflicts.length || e.review.some((r) => r.status === 'conflict' && r.mandatory)) return 'conflict';
  // a mandatory lock that needs review, an unsupported or rejected mandatory definition, or an unreadable clinician
  // intensity limit. (A1-001) An incomplete legacy symptom screen limits exercise only: the gate holds the prescription
  // at no sessions and the habitual steps (checked above), so it is not a review of a prescription without exercise
  if (e.review.some((r) => r.mandatory) || e.rejected.some((r) => r.mandatory) || e.exercise.intensity.some((c) => c.status === 'review')) return 'review';
  // the typed lock checks: a mandatory unsupported or unresolved bound leaves the prescription unchecked; so does a
  // clinician intensity maximum the prescription has no comparable dose for, or a required validator comparison
  if (e.exercise.intensity.some((c) => c.status === 'unchecked') || (e.validator.unchecked?.length ?? 0) > 0) return 'unchecked';
  if (e.evaluations.length && combineConstraintStatuses(e.evaluations) === 'unchecked') return 'unchecked';
  return 'verified';
}

/**
 * Status of an option (C5/D4-03): the constraint status, then the independent safety audit of the frozen candidate — a
 * failed audit needs review (a new planning attempt; never a silent retry), no audit (zero members, missing margins,
 * insufficient budget) is Unchecked. Verified only when every check passed. Never a human-safety probability.
 */
export function optionSafetyStatus(constraintStatus: SafetyStatus, audit: JointScreenResult | null | undefined): SafetyStatus {
  if (constraintStatus !== 'verified') return constraintStatus;
  if (!audit || audit.status === 'unchecked') return 'unchecked';
  if (audit.status === 'fail') return 'review';
  return 'verified';
}

/** True when a status lets a prescription be started / adopted (logging and inspection never need it). */
export const startableStatus = (s: SafetyStatus): boolean => s === 'verified';

// ------------------------------------------------------------------------------------------------ certificates (C5)

/**
 * Profile safety as the planner reads it (the certificate's canonical form): an absent safety is screening mode M0 with no
 * flags; a false or null flag, an empty list or answer set, and fasting opt-in or diabetes medication 'none' read as
 * absent everywhere in the planner and the engine, so they are dropped. Any flag that changes a rule is kept as given.
 */
export function canonicalProfileSafety(s: PlannerRequest['profile']['safety']): NonNullable<PlannerRequest['profile']['safety']> {
  const flags: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s?.flags ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (v === undefined || v === null || v === false) continue;
    if ((k === 'fastingOptIn' || k === 'diabetesMedication') && v === 'none') continue;
    if (Array.isArray(v) ? v.length === 0 : typeof v === 'object' && Object.keys(v as object).length === 0) continue;
    flags[k] = v;
  }
  return { mode: s?.mode ?? 'M0', flags: flags as NonNullable<PlannerRequest['profile']['safety']>['flags'] };
}

/** Version of the audit sampler protocol (Latin hypercube over the registry's variable parameters, member order m = 0…M−1). */
export const AUDIT_SAMPLER_VERSION = 1;

/**
 * The declared draw protocol of the reserved safety-audit stream (A1-035): the EVALUATOR's ensemble seed and member count
 * that actually generated the audited parameter vectors (never the optimizer's search seed), the named stream, the
 * sampler and member order, and optionally the hash of the evaluated parameter-vector sequence.
 */
export interface AuditProtocol {
  M: number;
  seed: number | string;
  stream?: 'ensemble/safetyAudit';
  sampler?: 'lhs';
  samplerVersion?: number;
  order?: 'memberAscending';
  /** Hash of the evaluated parameter-vector sequence (m = 0…M−1), when the issuer recorded it. */
  paramsHash?: string;
}

/** The extended protocol fields of a protocol (absent for a bare {M, seed}: legacy fingerprints stay unchanged). */
function protocolExtras(p: AuditProtocol): Omit<AuditProtocol, 'M' | 'seed'> | null {
  const { M: _m, seed: _s, ...rest } = p;
  void _m;
  void _s;
  return Object.keys(rest).length ? rest : null;
}

/** Version of the canonical audit subject hash (A1-011). */
export const AUDIT_SUBJECT_VERSION = 1;

/** Hash of the exact frozen schedule an audit evaluated (A1-011): the certificate requires equality with its subject. */
export function auditSubjectHash(schedule: Schedule): string {
  return contentHash({ v: AUDIT_SUBJECT_VERSION, schedule });
}

/**
 * An audit as an issuer must hand it to `issueCertificate` (A1-011): the screen, the hash of the subject it actually
 * evaluated and the protocol it actually used. A bare screen binds no subject and never issues Verified.
 */
export interface AuditedScreen {
  screen: JointScreenResult;
  subjectHash: string | null;
  protocol?: AuditProtocol;
}

/** Version of the canonical audit initial-state/controller hash and the energy-bias application law (A1-012). */
export const AUDIT_STATE_VERSION = 1;
/** How a forward run applies the energy-balance correction: a daily intake offset of `mean` kcal (sd for scenarios). */
export const ENERGY_BIAS_LAW = 'intakeOffsetKcalPerDay.v1';

/** The actual initial state and controller inputs a re-plan audit's forward model consumed (A1-012). */
export interface AuditStateInput {
  anchorDate: string;
  /** Plan-day index of the anchor, when known. */
  anchorDay?: number;
  /** The full snapshot content (state, trace prefix, latches, bus) — never only its compatibility key. */
  snapshot: unknown;
  particles?: unknown;
  energyBiasKcal: { mean: number; sd: number };
  trendWeight: { kg: number; sd: number };
}

/**
 * Canonical versioned hash of the audit's initial state and controller (A1-012): anchor, the full snapshot content, used
 * particle states/weights, the energy-bias correction mean/sd with its application law, and the trend. Separate from the
 * immutable observation-history hash (both are bound). Lifecycle consumers pass the CURRENT state's hash.
 */
export function auditStateHash(state: AuditStateInput): string {
  return contentHash({
    v: AUDIT_STATE_VERSION,
    anchorDate: state.anchorDate,
    anchorDay: state.anchorDay ?? null,
    snapshot: state.snapshot ?? null,
    particles: state.particles ?? null,
    energyBias: { mean: state.energyBiasKcal.mean, sd: state.energyBiasKcal.sd, law: ENERGY_BIAS_LAW },
    trend: { kg: state.trendWeight.kg, sd: state.trendWeight.sd },
  });
}

/** Certificate inputs of a planner certificate: the contract's fields plus the planner-specific subject parts. */
export type PlannerCertificateInputs = CertificateInputs & {
  /** (A1-006) Rejected definitions with their supplied values (only when any). */
  rejected?: readonly RejectedConstraint[];
  /** (A1-003) The normalized clinician intensity policy beside the original envelopes (only when any). */
  intensityPolicy?: ReadonlyArray<{ envelopeId: string; original: ExerciseIntensityCap['original']; status: ExerciseIntensityCap['status']; normalized: ExerciseIntensityCap['normalized'] }>;
  /** (A1-035) The evaluator's audit protocol beyond the contract's draw protocol (only when declared). */
  auditProtocol?: Omit<AuditProtocol, 'M' | 'seed'>;
  clinicalNutrition?: { scope: PlanningContext['caps']['renal']['clinical']; habitual: PlanningContext['caps']['renal']['habitualProvenance'] };
};

/**
 * What a planner certificate binds (C5): final schedule, initial state, profile, screening, symptoms, locks (rejected and
 * unsupported definitions included), the intensity policy, versions, required margins and the audit protocol.
 * `stateHash` is the actual audit initial-state/controller hash (`auditStateHash`) of a re-plan; without it the initial
 * state is the profile at the plan start (a start certificate).
 */
export function plannerCertificateInputs(ctx: PlanningContext, schedule: Schedule, requiredMargins: readonly string[], protocol: AuditProtocol, historyHash?: string, stateHash?: string): PlannerCertificateInputs {
  const req = ctx.request;
  const pf = ctx.rp.safety.flags;
  // the profile at the start date the context resolved and with its safety in the planner's canonical reading: a request
  // without `profile.startDate` and one carrying the same date, or two screening mappings that agree in meaning, bind
  // the same person and plan start (issuer and lifecycle revalidation fingerprint the same profile)
  const profile: PlannerRequest['profile'] = { ...req.profile, startDate: ctx.startDate, safety: canonicalProfileSafety(req.profile.safety) };
  const rejected = ctx.caps.constraints.rejected.map((r) => ({ constraintId: r.def.id, reason: r.reason, value: r.def.value, unit: r.def.unit, mandatory: r.def.mandatory, source: r.def.source.kind }));
  const intensity = (ctx.caps.exercise.intensityCaps ?? []).map((c) => ({ envelopeId: c.envelopeId, original: c.original, status: c.status, normalized: c.normalized }));
  const extras = protocolExtras(protocol);
  return {
    schedule,
    initialStateHash: stateHash ?? contentHash({ profile, startDate: ctx.startDate, horizonDays: ctx.horizonDays }),
    ...(historyHash ? { historyHash } : {}),
    profile,
    screening: req.safety ?? null,
    symptoms: { symptoms: pf.symptoms ?? [], envelopes: pf.exerciseEnvelopes ?? [], answers: pf.answers ?? {} },
    constraints: ctx.caps.constraints.definitions ?? ctx.caps.constraints.merged,
    ...(ctx.caps.renal.context !== 'none' || ctx.caps.renal.clinical.envelopes.length ? { clinicalNutrition: { scope: ctx.caps.renal.clinical, habitual: ctx.caps.renal.habitualProvenance } } : {}),
    actives: { creatineMaxG: ctx.caps.creatineMaxG, review: ctx.caps.constraints.review },
    versions: { engine: ENGINE_VERSION, registry: buildModelParams(MODULES).registryHash, policy: CONTRACT_VERSIONS.constraintPolicy, contracts: CONTRACT_FINGERPRINT },
    requiredMargins,
    population: 'adult planner domain',
    drawProtocol: { stream: 'safetyAudit', M: protocol.M, seed: protocol.seed, method: 'lhs' },
    ...(rejected.length ? { rejected } : {}),
    ...(intensity.length ? { intensityPolicy: intensity } : {}),
    ...(extras ? { auditProtocol: extras } : {}),
  };
}

/** A planner certificate: the contract's certificate plus the audited subject and the actual protocol (A1-011/A1-035). */
export type PlannerSafetyCertificate = SafetyCertificate & {
  /** Hash of the subject the audit actually evaluated (equal to the certificate subject's when verified). */
  auditSubjectHash?: string | null;
  /** The extended audit protocol the fingerprint was computed with. */
  auditProtocol?: Omit<AuditProtocol, 'M' | 'seed'>;
  /** Why a certificate is not verified although its screen passed ('subjectMismatch', 'protocolMismatch', 'unboundAudit'). */
  reasonCode?: string;
};

const isAuditedScreen = (a: JointScreenResult | AuditedScreen): a is AuditedScreen => typeof (a as AuditedScreen).screen === 'object' && (a as AuditedScreen).screen !== null && 'subjectHash' in a;

/**
 * A certificate for one frozen candidate (C5/D4-03): verified only when the constraint checks are verified, the one
 * automatic audit of this decision episode passed, and that audit evaluated EXACTLY this certificate's subject under its
 * declared protocol (A1-011/A1-035). A bare screen (no subject) is recorded but never verified. Earlier audits stay in
 * `history` (never discarded).
 */
export function issueCertificate(
  inputs: CertificateInputs,
  audited: AuditedScreen | JointScreenResult,
  constraintStatus: SafetyStatus,
  opts: { episodeId: string; createdAt: IsoInstant; history?: SafetyCertificate['history'] },
): PlannerSafetyCertificate {
  const fingerprint = certificateFingerprint(inputs);
  const a: AuditedScreen = isAuditedScreen(audited) ? audited : { screen: audited, subjectHash: null };
  const audit = a.screen;
  const expected = auditSubjectHash(inputs.schedule as Schedule);
  const subjectOk = a.subjectHash !== null && a.subjectHash === expected;
  const declared = inputs.drawProtocol;
  const protocolOk = !a.protocol || (a.protocol.M === declared.M && String(a.protocol.seed) === String(declared.seed) && (!a.protocol.paramsHash || (inputs as PlannerCertificateInputs).auditProtocol?.paramsHash === a.protocol.paramsHash));
  const bound = subjectOk && protocolOk;
  const status: SafetyCertificate['status'] = audit.status === 'fail' ? 'failed' : constraintStatus === 'verified' && audit.status === 'pass' && bound ? 'verified' : 'unchecked';
  const reasonCode = audit.status === 'pass' && constraintStatus === 'verified' && !bound ? (a.subjectHash === null ? 'unboundAudit' : !subjectOk ? 'subjectMismatch' : 'protocolMismatch') : undefined;
  const extras = (inputs as PlannerCertificateInputs).auditProtocol;
  return {
    kind: 'vitals.safetyCertificate',
    version: CONTRACT_VERSIONS.safetyCertificate,
    fingerprint,
    episodeId: opts.episodeId,
    attempt: 1,
    status,
    audit,
    constraintStatus,
    createdAt: opts.createdAt,
    requiredMargins: [...inputs.requiredMargins],
    drawProtocol: { ...inputs.drawProtocol },
    ...(opts.history?.length ? { history: opts.history } : {}),
    auditSubjectHash: a.subjectHash,
    ...(extras ? { auditProtocol: { ...extras } } : {}),
    ...(reasonCode ? { reasonCode } : {}),
  };
}

/** Assemble the `OptionSafety` record of an option (C5): evaluations, selection screen, audit, certificate. */
export function optionSafetyOf(
  e: PlanSafetyEvaluation,
  parts: { selection?: JointScreenResult | null; audit?: JointScreenResult | null; certificate?: SafetyCertificate | null; holdoutDraws?: number },
): OptionSafety {
  // the option is Verified only with a verified certificate (a passed screen of another subject never counts, A1-011)
  const status0 = optionSafetyStatus(e.status, parts.audit);
  const status: SafetyStatus = status0 === 'verified' && parts.certificate && parts.certificate.status !== 'verified' ? 'unchecked' : status0;
  return {
    status,
    evaluations: e.evaluations,
    ...(e.conflicts.length ? { conflicts: e.conflicts } : {}),
    ...(parts.selection ? { selection: parts.selection } : {}),
    ...(parts.audit ? { audit: parts.audit } : {}),
    ...(parts.certificate ? { certificate: parts.certificate } : {}),
    outcomeHoldout: { draws: Math.max(0, parts.holdoutDraws ?? 0), status: (parts.holdoutDraws ?? 0) > 0 ? 'evaluated' : 'notRun' },
  };
}

/**
 * The request compiled for exactly this schedule's start and length (a slice shorter than the planner's minimum horizon
 * keeps its own length instead of the clamp).
 */
export function contextForSchedule(request: PlannerRequest, schedule: Schedule): PlanningContext {
  const startDate = schedule.startDate ?? request.startDate;
  const ctx = compileRequest({ ...request, horizonDays: schedule.horizonDays, ...(startDate ? { startDate, profile: { ...request.profile, startDate } } : {}) });
  return ctx.horizonDays === schedule.horizonDays ? ctx : withHorizon(ctx, schedule.horizonDays);
}

/**
 * The prescription a safety check or certificate covers from plan day `fromDay` (C5): the schedule's days [fromDay, H)
 * with the start date moved (events and blocks re-indexed) and the request at that start. Days before `fromDay` are lived
 * history: they are neither re-judged nor fingerprinted. `fromDay` ≤ 0 is the whole schedule, unchanged (a start); a day
 * past the end is clamped to the last day. Issuers (re-plan) and lifecycle revalidation (replan / adopt / resume) use this
 * one definition, so the same prescription yields the same fingerprint.
 */
export function safetySubject<R extends PlannerRequest>(request: R, schedule: Schedule, fromDay = 0): { request: R; schedule: Schedule; fromDay: number } {
  const from = Math.max(0, Math.min(schedule.horizonDays - 1, Math.floor(Number.isFinite(fromDay) ? fromDay : 0)));
  if (from === 0) return { request, schedule, fromDay: 0 };
  const s = sliceSchedule(schedule, from, schedule.horizonDays);
  return { request: { ...request, startDate: s.startDate, horizonDays: s.horizonDays, profile: { ...request.profile, startDate: s.startDate } }, schedule: s, fromDay: from };
}

/** Result of re-validating a stored prescription at a lifecycle boundary. */
export interface LifecycleSafety {
  boundary: LifecycleBoundary;
  /** Current status: the constraint checks on the current profile/safety, capped by the certificate's validity. */
  status: SafetyStatus;
  /**
   * (A1-001) The authoritative, scope-aware decision: true only when every applicable mandatory check of this exact
   * subject passed and a current verified certificate binds it. Consumers refuse activation otherwise.
   */
  startable: boolean;
  /** Why not startable: 'blocked' | 'violation' | 'conflict' | 'review' | 'unchecked' (a mandatory bound unresolved) | 'certificateRequired' (checks pass; no current certificate binds this subject: a declared final audit is needed) | 'certificateFailed'. */
  reasonCode: string | null;
  /** The stored certificate matches the current fingerprint and is verified. */
  certificateValid: boolean;
  fingerprint: string;
  evaluation: PlanSafetyEvaluation;
  /** Plan day the judged prescription starts at (`safetySubject`; 0 = the whole schedule). */
  fromDay: number;
  /** Explicit tracking permission, never a verified checked-plan certificate. */
  experimentalTracking?: ExperimentalTrackingReview;
}

/**
 * Re-validate a stored schedule under the CURRENT request (profile, screening, symptoms, locks) at a lifecycle boundary
 * (C5: run / start / adopt / resume / replan / scenario start / safety, medication or symptom change). A certificate
 * authorizes only when verified and its fingerprint equals the one recomputed now; otherwise the prescription is at most
 * Unchecked — never startable — until a fresh declared audit. Logging and inspection never depend on this.
 *
 * `fromDay` names the plan day the prescription runs from (a re-plan, adopt or resume boundary: today's plan day, or the
 * version's `effectiveFromDay`): only `safetySubject(request, schedule, fromDay)` is judged and fingerprinted, with the
 * elapsed days placing it in the plan's weeks, so lived history never blocks a prescription and a re-plan certificate
 * issued on that subject re-validates. Without it the whole schedule is the subject (a start). `stateHash` is the CURRENT
 * audit initial-state/controller hash (`auditStateHash` of the current confirmed state, A1-012): a re-plan certificate
 * binds one, so without the current one (or with another) it is not valid. Never pass the certificate's own value.
 */
export function revalidatePlanSafety(
  request: PlannerRequest,
  schedule: Schedule,
  opts: {
    boundary: LifecycleBoundary;
    certificate?: SafetyCertificate | null;
    /** Defaults to the certificate's own `requiredMargins` (none: the certificate cannot be valid). */
    requiredMargins?: readonly string[];
    /** Defaults to the certificate's own `drawProtocol` (none: the certificate cannot be valid). */
    protocol?: AuditProtocol;
    /** Plan day the prescription runs from (default 0: the whole schedule). */
    fromDay?: number;
    /** A simulation of the whole schedule (or of the subject when `simDayOffset` says so); default offset `fromDay`. */
    sim?: SimulationResult | null;
    simDayOffset?: number;
    historyHash?: string;
    /** The CURRENT audit initial-state/controller hash (A1-012). */
    stateHash?: string;
    /** Days from the plan start to the subject's day 0 (default: the subject's `fromDay`). */
    elapsedDays?: number;
  },
): LifecycleSafety {
  const subject = safetySubject(request, schedule, opts.fromDay ?? 0);
  const ctx = contextForSchedule(subject.request, subject.schedule);
  const evaluation = evaluatePlanSafety(ctx, subject.schedule, opts.sim, { simDayOffset: opts.simDayOffset ?? subject.fromDay, elapsedDays: opts.elapsedDays ?? subject.fromDay });
  const cert = (opts.certificate ?? null) as PlannerSafetyCertificate | null;
  const margins = opts.requiredMargins ?? cert?.requiredMargins;
  // the certificate's own protocol identity (stream, sampler, order, parameter-vector hash) completes a bare {M, seed}
  const protocol: AuditProtocol | undefined = opts.protocol
    ? { ...(cert?.auditProtocol ?? {}), ...opts.protocol }
    : cert?.drawProtocol
      ? { M: cert.drawProtocol.M, seed: cert.drawProtocol.seed, ...(cert.auditProtocol ?? {}) }
      : undefined;
  const fingerprint = certificateFingerprint(plannerCertificateInputs(ctx, subject.schedule, margins ?? [], protocol ?? { M: 0, seed: '' }, opts.historyHash, opts.stateHash));
  // a certificate whose margins/protocol are unknown cannot be re-derived, so it never authorizes (C5)
  const certificateValid = margins !== undefined && protocol !== undefined && certificateAuthorizes(cert, fingerprint);
  const blocked = ctx.caps.blocked ? 'review' : null;
  const status: SafetyStatus = blocked ?? (evaluation.status !== 'verified' ? evaluation.status : certificateValid ? 'verified' : 'unchecked');
  const startable = startableStatus(status);
  const reasonCode = startable
    ? null
    : blocked
      ? 'blocked'
      : evaluation.status !== 'verified'
        ? evaluation.status
        : cert && cert.status === 'failed' && cert.fingerprint === fingerprint
          ? 'certificateFailed'
          : 'certificateRequired';
  const experimentalTracking = reviewExperimentalTracking(ctx, subject.schedule, evaluation, opts.sim);
  return { boundary: opts.boundary, status, startable, reasonCode, certificateValid, fingerprint, evaluation, fromDay: subject.fromDay, ...(experimentalTracking ? { experimentalTracking } : {}) };
}

/** Short inline word of a safety status (C6): Verified / Unchecked / Limit conflict / Review / Over limit. */
export const SAFETY_STATUS_LABEL: Readonly<Record<SafetyStatus, string>> = {
  verified: 'Verified',
  unchecked: 'Unchecked',
  conflict: 'Limit conflict',
  review: 'Review',
  violation: 'Over limit',
};

/**
 * Notes for verified lock limits only (D4-01: no enforcement sentence without a passed final check). Amounts carry their
 * unit (g/day, mg/day, % of energy, % of maintenance).
 */
export function verifiedLimitNotes(evals: readonly ConstraintEvaluation[], defs: readonly ConstraintDef[]): string[] {
  const out: string[] = [];
  for (const e of evals) {
    if (e.status !== 'pass' || e.capability === 'unsupported') continue;
    const d = defs.find((x) => x.id === e.constraintId && constraintKey(x) === e.key);
    if (!d || d.source.kind !== 'marker') continue;
    const v = Math.round(d.value * 10) / 10;
    switch (d.quantity) {
      case 'fatPctEnergy':
        out.push(`Total fat stays at or below ${v} % of energy (blood result).`);
        break;
      case 'caffeinePerDay':
        out.push(`The plan adds no more than ${v} mg/day of caffeine (blood result).`);
        break;
      case 'alcoholPerDay':
        out.push(v <= 0 ? 'The plan adds no alcohol (blood result).' : `The plan adds no more than ${v} g/day of alcohol (blood result).`);
        break;
      case 'creatinePerDay':
        if (v > 0) out.push(`The plan adds no more than ${v} g/day of creatine (blood result).`);
        break;
      case 'potassiumSupplementPerDay':
        out.push(v <= 0 ? 'The plan adds no potassium supplement (blood result).' : `The plan adds no more than ${v} g/day of potassium supplement (blood result).`);
        break;
      default:
        break;
    }
  }
  return out;
}
