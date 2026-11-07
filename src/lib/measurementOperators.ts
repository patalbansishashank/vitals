/**
 * C4 measurement operators (review 2026-10-18, `_CONTRACTS.md` C4): every measured outcome is compared with the model only
 * through an operator that maps a model path at the measurement's time to the observed quantity. Observables that share
 * a unit string are not interchangeable (scale mass ≠ water-adjusted mass ≠ model tissue mass; DXA % ≠ BIA % ≠ tissue fat
 * fraction; indexed eGFR ≠ absolute GFR ≠ creatinine clearance).
 *
 * Exports: OPERATOR_TAGS/OperatorTag/OperatorId, operatorTag, legacyMeasurementContext, comparability, TaggedObservation, dependentObservationGroups, ModelPath,
 * MeasurementOperator (+ SCALE_WAKE / WATER_ADJUSTED_WAKE / MODEL_TISSUE_MASS / TISSUE_FAT_FRACTION operators),
 * applyOperator, jointDifferences, empiricalQuantiles, differenceVariance, TREND_FILTER_DEFAULTS, trendObservationSdKg,
 * trendProcessNoise, BALANCE_CORRECTION_BOUNDS, boundBalanceCorrection, BodyCompositionObservation, fatMassObservation,
 * GirthLandmark, BloodPressureEpisode, bpEpisodeStatus, bpSessionCoverage, KetoneSpecimen, ketoneOperatorFor,
 * GfrQuantityKind, gfrQuantityFromUnit, mostellerBsaM2, indexGfr, LabSample/LabSampleContext, fastingSampleEligibility,
 * occurrenceConsistency, drawIdentityLinked, pairedFastingEligibility, selectDrawPartner, MULTI_DAY_FAST_HOURS,
 * homaContextReasons, homaEligibility, homaIr, homaDescriptiveRatio, DatedMedicationChange/MedicationScreen,
 * medicationStateAt, medicationChronology (re-audit 2026-10-19: A1-034, A1-047, A1-059, A1-063).
 *
 * Pure: no IO, no clock reads, no new physiological coefficients. The numbers here are the review's named engineering
 * defaults (filter noise, correction bounds) and declared definitions (Mosteller BSA, HOMA denominator, 1.73 m² index).
 */
import type { IsoDate, IsoInstant, OccurrenceTime, QuantityProvenance } from './bodyContracts';

// =====================================================================================================================
// observables and operator tags
// =====================================================================================================================

export type ObservableKind =
  | 'scaleMass'
  | 'waterAdjustedMass'
  | 'inferredNonFatScaleMass'
  | 'modelTissueMass'
  | 'modelFatMass'
  | 'modelLeanTissue'
  | 'tissueFatFraction'
  | 'scaleBodyFatPct'
  | 'dxaFatMass'
  | 'deviceFatMass'
  | 'dxaBodyFatPct'
  | 'dxaLeanSoftTissue'
  | 'biaBodyFatPct'
  | 'navyBodyFatPct'
  | 'skinfoldBodyFatPct'
  | 'waistGirth'
  | 'pairedBloodPressure'
  | 'fastingPlasmaGlucose'
  | 'hba1c'
  | 'dBhbEndpoint'
  | 'bhbHourlyMean'
  | 'egfrIndexed'
  | 'gfrAbsolute'
  | 'creatinineClearance'
  | 'urinaryNitrogenPrior'
  | 'modelBodyNitrogenChange'
  | 'hungerRating'
  | 'dxaBmd';

/** When on the model path the observable is sampled. */
export type SampleTime = 'wake' | 'midnight' | 'endOfDay' | 'hourMean' | 'instant' | 'dayMean' | 'episode';
/** Whether model labile water (glycogen water, ECF, gut, creatine) is removed from the observable. */
export type WaterConvention = 'raw' | 'modelLabileWaterRemoved' | 'notApplicable';
/**
 * Measurement context: `standardized` (protocol followed, e.g. morning, fasted, post-void), `unstandardized`, `unknown`.
 * Unknown context uses unstandardized assumptions, never morning-standardized precision (C4).
 */
export type MeasurementContext = 'standardized' | 'unstandardized' | 'unknown';

export interface OperatorTag {
  id: string;
  observable: ObservableKind;
  unit: string;
  sampleTime: SampleTime;
  water: WaterConvention;
  /** Operator semantics version (0 = legacy semantics kept only to read old records). */
  version: number;
  legacy?: boolean;
}

/** The operator registry (C4). Ids are stable keys stored on observations and forecasts. */
export const OPERATOR_TAGS = {
  scaleWake: { id: 'scaleWake', observable: 'scaleMass', unit: 'kg', sampleTime: 'wake', water: 'raw', version: 1 },
  waterAdjustedWake: { id: 'waterAdjustedWake', observable: 'waterAdjustedMass', unit: 'kg', sampleTime: 'wake', water: 'modelLabileWaterRemoved', version: 1 },
  /** Untagged legacy `trendWeight.kg`: latent water-adjusted mass, never reusable as a raw scale observation (D5-02). */
  legacyTrendWeight: { id: 'legacyTrendWeight', observable: 'waterAdjustedMass', unit: 'kg', sampleTime: 'wake', water: 'modelLabileWaterRemoved', version: 0, legacy: true },
  inferredNonFatScaleMass: { id: 'inferredNonFatScaleMass', observable: 'inferredNonFatScaleMass', unit: 'kg', sampleTime: 'wake', water: 'raw', version: 1 },
  modelTissueMass: { id: 'modelTissueMass', observable: 'modelTissueMass', unit: 'kg', sampleTime: 'endOfDay', water: 'notApplicable', version: 1 },
  modelFatMass: { id: 'modelFatMass', observable: 'modelFatMass', unit: 'kg', sampleTime: 'endOfDay', water: 'notApplicable', version: 1 },
  modelLeanTissue: { id: 'modelLeanTissue', observable: 'modelLeanTissue', unit: 'kg', sampleTime: 'endOfDay', water: 'notApplicable', version: 1 },
  tissueFatFraction: { id: 'tissueFatFraction', observable: 'tissueFatFraction', unit: '%', sampleTime: 'endOfDay', water: 'notApplicable', version: 1 },
  scaleBodyFatWake: { id: 'scaleBodyFatWake', observable: 'scaleBodyFatPct', unit: '%', sampleTime: 'wake', water: 'raw', version: 1 },
  dxaFatMass: { id: 'dxaFatMass', observable: 'dxaFatMass', unit: 'kg', sampleTime: 'instant', water: 'raw', version: 1 },
  /** Fat mass reported by a non-DXA device (BIA scan fat kg, or % × that device's own measured mass). */
  deviceFatMass: { id: 'deviceFatMass', observable: 'deviceFatMass', unit: 'kg', sampleTime: 'instant', water: 'raw', version: 1 },
  dxaBodyFat: { id: 'dxaBodyFat', observable: 'dxaBodyFatPct', unit: '%', sampleTime: 'instant', water: 'raw', version: 1 },
  dxaLean: { id: 'dxaLean', observable: 'dxaLeanSoftTissue', unit: 'kg', sampleTime: 'instant', water: 'raw', version: 1 },
  biaBodyFat: { id: 'biaBodyFat', observable: 'biaBodyFatPct', unit: '%', sampleTime: 'instant', water: 'raw', version: 1 },
  navyBodyFat: { id: 'navyBodyFat', observable: 'navyBodyFatPct', unit: '%', sampleTime: 'instant', water: 'raw', version: 1 },
  skinfoldBodyFat: { id: 'skinfoldBodyFat', observable: 'skinfoldBodyFatPct', unit: '%', sampleTime: 'instant', water: 'raw', version: 1 },
  waist: { id: 'waist', observable: 'waistGirth', unit: 'cm', sampleTime: 'instant', water: 'raw', version: 1 },
  bloodPressure: { id: 'bloodPressure', observable: 'pairedBloodPressure', unit: 'mmHg', sampleTime: 'episode', water: 'notApplicable', version: 1 },
  fastingGlucose: { id: 'fastingGlucose', observable: 'fastingPlasmaGlucose', unit: 'mmol/L', sampleTime: 'instant', water: 'notApplicable', version: 1 },
  hba1c: { id: 'hba1c', observable: 'hba1c', unit: '%', sampleTime: 'instant', water: 'notApplicable', version: 1 },
  /** D-BHB at the sampling instant (capillary/venous blood meter); not the hourly-mean model series (D2-08). */
  bhbEndpoint: { id: 'bhbEndpoint', observable: 'dBhbEndpoint', unit: 'mmol/L', sampleTime: 'instant', water: 'notApplicable', version: 1 },
  bhbHourlyMean: { id: 'bhbHourlyMean', observable: 'bhbHourlyMean', unit: 'mmol/L', sampleTime: 'hourMean', water: 'notApplicable', version: 1 },
  egfrIndexed: { id: 'egfrIndexed', observable: 'egfrIndexed', unit: 'mL/min/1.73m²', sampleTime: 'instant', water: 'notApplicable', version: 1 },
  gfrAbsolute: { id: 'gfrAbsolute', observable: 'gfrAbsolute', unit: 'mL/min', sampleTime: 'instant', water: 'notApplicable', version: 1 },
  creatinineClearance: { id: 'creatinineClearance', observable: 'creatinineClearance', unit: 'mL/min', sampleTime: 'instant', water: 'notApplicable', version: 1 },
  /**
   * Model urinary-N excretion prior (D2-05): nonnegative; the hourly urinary rate integrated over the modelled active hours
   * (a full-day g N/d only for a fully modelled 24 h collection). Not muscle protein loss and not body-N change.
   */
  urinaryNitrogen: { id: 'urinaryNitrogen', observable: 'urinaryNitrogenPrior', unit: 'g N/d', sampleTime: 'dayMean', water: 'notApplicable', version: 1 },
  /**
   * Signed model body-N change (D2-05, `COMPOSITION_NITROGEN_LEDGER.nitrogenBalance`): ΔLT·1000/(1 + h_P)/6.25 g N/d over
   * the body excluding the gut lumen. A model quantity, not an excretion: fed intake, non-urinary losses and non-protein
   * pools keep it from being −urinary N, so it is never compared with a urine collection (no observation maps to it).
   */
  modelBodyNitrogenChange: { id: 'modelBodyNitrogenChange', observable: 'modelBodyNitrogenChange', unit: 'g N/d', sampleTime: 'dayMean', water: 'notApplicable', version: 1 },
  hungerRating: { id: 'hungerRating', observable: 'hungerRating', unit: '0–10', sampleTime: 'instant', water: 'notApplicable', version: 1 },
  dxaBmd: { id: 'dxaBmd', observable: 'dxaBmd', unit: 'g/cm²', sampleTime: 'instant', water: 'notApplicable', version: 1 },
} as const satisfies Record<string, OperatorTag>;
export type OperatorId = keyof typeof OPERATOR_TAGS;

/**
 * Map the legacy measurement `context` to a protocol context (C4/D5-04): only an explicit morning-fasted reading is
 * standardized; evening/post-workout are unstandardized; an absent or 'unknown' context stays unknown (old code defaulted
 * it to standardized; the original value is not rewritten).
 */
export function legacyMeasurementContext(context: 'morningFasted' | 'evening' | 'postWorkout' | 'unknown' | undefined | null): MeasurementContext {
  if (context === 'morningFasted') return 'standardized';
  if (context === 'evening' || context === 'postWorkout') return 'unstandardized';
  return 'unknown';
}

export function operatorTag(id: OperatorId | OperatorTag): OperatorTag {
  return typeof id === 'string' ? OPERATOR_TAGS[id] : id;
}

/**
 * Whether two quantities may be compared (differenced, put in one likelihood) without an operator in between (C4):
 * same observable, unit, sample time and water convention. Matching units alone never suffice.
 */
export function comparability(a: OperatorId | OperatorTag, b: OperatorId | OperatorTag): { ok: true } | { ok: false; reason: 'observableDiffers' | 'unitDiffers' | 'sampleTimeDiffers' | 'waterConventionDiffers' } {
  const x = operatorTag(a);
  const y = operatorTag(b);
  if (x.observable !== y.observable) return { ok: false, reason: 'observableDiffers' };
  if (x.unit !== y.unit) return { ok: false, reason: 'unitDiffers' };
  if (x.sampleTime !== y.sampleTime) return { ok: false, reason: 'sampleTimeDiffers' };
  if (x.water !== y.water) return { ok: false, reason: 'waterConventionDiffers' };
  return { ok: true };
}

/** A measured outcome with everything C4 requires: identity, time, unit, method/device/protocol, parents and context. */
export interface TaggedObservation {
  observationId: string;
  revision?: number;
  operator: OperatorId;
  value: number;
  unit: string;
  occurrence: OccurrenceTime;
  recordedAt?: IsoInstant;
  method?: string;
  device?: string;
  protocol?: string;
  context: MeasurementContext;
  /** Observations this one was derived from (Navy from girths, BF% from a BIA impedance record…). */
  parents: readonly string[];
  repeats?: readonly number[];
  provenance: QuantityProvenance;
  /** Short-term repeatability SD and non-vanishing systematic (device/method bias) SD, in `unit`. */
  repeatabilitySd?: number;
  systematicSd?: number;
}

/**
 * Groups of mutually dependent observations (C4/D1-03): observations sharing any ancestor (or each other) are one group,
 * so parent-derived Navy/BIA estimates never count as independent evidence about the same source. Groups are sorted by
 * their smallest id; members keep input order.
 */
export function dependentObservationGroups<O extends { observationId: string; parents: readonly string[] }>(obs: readonly O[]): O[][] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.has(c) && parent.get(c) !== r) {
      const n = parent.get(c)!;
      parent.set(c, r);
      c = n;
    }
    if (!parent.has(r)) parent.set(r, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  };
  for (const o of obs) {
    find(o.observationId);
    for (const p of o.parents) union(o.observationId, p);
  }
  const groups = new Map<string, O[]>();
  for (const o of obs) {
    const r = find(o.observationId);
    const g = groups.get(r) ?? [];
    g.push(o);
    groups.set(r, g);
  }
  const minId = (g: O[]) => g.reduce((m, o) => (o.observationId < m ? o.observationId : m), g[0]!.observationId);
  return [...groups.values()].sort((a, b) => (minId(a) < minId(b) ? -1 : 1));
}

// =====================================================================================================================
// operators over model paths
// =====================================================================================================================

/**
 * Read access to one model path (nominal run or one ensemble member). `name` is an engine signal/series name
 * (`scaleWeightKg`, `labileWaterKg`, `fatMassKg`, `ffmActKg`, `tissueMassKg`…); `hourIndex` is the absolute hour since t = 0.
 * Returns null when the quantity is not recorded at that hour (never a sentinel).
 */
export interface ModelPath {
  value(name: string, hourIndex: number): number | null;
}

export interface MeasurementOperator {
  tag: OperatorTag;
  /** Path quantities the operator reads. */
  requires: readonly string[];
  /** The predicted observable at `hourIndex` on `path`, or null when any input is missing or non-finite. */
  apply(path: ModelPath, hourIndex: number): number | null;
}

const fin = (x: number | null): x is number => x !== null && Number.isFinite(x);

export const SCALE_WAKE_OPERATOR: MeasurementOperator = {
  tag: OPERATOR_TAGS.scaleWake,
  requires: ['scaleWeightKg'],
  apply: (p, h) => {
    const s = p.value('scaleWeightKg', h);
    return fin(s) ? s : null;
  },
};

/** Same-path scale minus same-path labile water (D5-02): never two independently drawn percentiles. */
export const WATER_ADJUSTED_WAKE_OPERATOR: MeasurementOperator = {
  tag: OPERATOR_TAGS.waterAdjustedWake,
  requires: ['scaleWeightKg', 'labileWaterKg'],
  apply: (p, h) => {
    const s = p.value('scaleWeightKg', h);
    const w = p.value('labileWaterKg', h);
    return fin(s) && fin(w) ? s - w : null;
  },
};

export const MODEL_TISSUE_MASS_OPERATOR: MeasurementOperator = {
  tag: OPERATOR_TAGS.modelTissueMass,
  requires: ['fatMassKg', 'ffmActKg'],
  apply: (p, h) => {
    const fm = p.value('fatMassKg', h);
    const ffm = p.value('ffmActKg', h);
    return fin(fm) && fin(ffm) ? fm + ffm : null;
  },
};

/**
 * Tissue fat fraction 100·FM/(FM + FFM_act) at one sampled time (C6/D4-05) under the engine's tissue-mass convention.
 * `FM + leanTissue` omits reference glycogen/water and is not this denominator.
 */
export const TISSUE_FAT_FRACTION_OPERATOR: MeasurementOperator = {
  tag: OPERATOR_TAGS.tissueFatFraction,
  requires: ['fatMassKg', 'ffmActKg'],
  apply: (p, h) => {
    const fm = p.value('fatMassKg', h);
    const ffm = p.value('ffmActKg', h);
    return fin(fm) && fin(ffm) && fm + ffm > 0 ? (100 * fm) / (fm + ffm) : null;
  },
};

/** Apply one operator to every member path before any quantile (C4). */
export function applyOperator(op: MeasurementOperator, paths: readonly ModelPath[], hourIndex: number): Array<number | null> {
  return paths.map((p) => op.apply(p, hourIndex));
}

/** observed − predicted per member (joint differences precede quantiles; members without a value are skipped). */
export function jointDifferences(observed: number, predicted: ReadonlyArray<number | null>): number[] {
  if (!Number.isFinite(observed)) return [];
  const out: number[] = [];
  for (const p of predicted) if (fin(p)) out.push(observed - p);
  return out;
}

/** Empirical quantiles (linear interpolation, type 7) of finite samples; null when there are none. */
export function empiricalQuantiles(samples: readonly number[], probs: readonly number[] = [0.1, 0.5, 0.9]): number[] | null {
  const xs = samples.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!xs.length) return null;
  return probs.map((q) => {
    const qq = Math.min(1, Math.max(0, q));
    const h = (xs.length - 1) * qq;
    const lo = Math.floor(h);
    const hi = Math.ceil(h);
    return xs[lo]! + (h - lo) * (xs[hi]! - xs[lo]!);
  });
}

/**
 * Var(A − B) = Var(A) + Var(B) − 2·Cov(A, B) (C4). Used for scale − model water and current − forecast. Returns null for
 * non-finite inputs or an inconsistent (negative) result rather than clamping it into a precise-looking number.
 */
export function differenceVariance(varA: number, varB: number, covAB: number): number | null {
  if (![varA, varB, covAB].every(Number.isFinite) || varA < 0 || varB < 0) return null;
  const v = varA + varB - 2 * covAB;
  return v < -1e-12 ? null : Math.max(0, v);
}

// =====================================================================================================================
// trend filter and balance-correction engineering defaults (C4)
// =====================================================================================================================

/**
 * Provisional trend-filter engineering starting values (C4), not tissue fluxes or universal physiology: relative
 * observation SD 0.005 (standardized) / 0.0065 (unstandardized), discrete daily state-increment SD qW = 0.03 kg and
 * rate-increment SD qR = 0.005 kg/day, all scaled by mass/75 kg. Held-out coverage must be calibrated before confidence claims.
 */
export const TREND_FILTER_DEFAULTS = {
  referenceMassKg: 75,
  relObsSdStandardized: 0.005,
  relObsSdUnstandardized: 0.0065,
  qWKgPerDay: 0.03,
  qRKgPerDayPerDay: 0.005,
  label: 'engineeringDefault',
} as const;

/** Observation SD of one weigh-in, kg: unknown context uses the unstandardized value (C4). */
export function trendObservationSdKg(massKg: number, context: MeasurementContext): number | null {
  if (!Number.isFinite(massKg) || massKg <= 0) return null;
  return massKg * (context === 'standardized' ? TREND_FILTER_DEFAULTS.relObsSdStandardized : TREND_FILTER_DEFAULTS.relObsSdUnstandardized);
}

/** Daily process-noise SDs scaled by mass/75 (discrete daily-noise SDs, not variances). */
export function trendProcessNoise(massKg: number): { qWKg: number; qRKgPerDay: number } | null {
  if (!Number.isFinite(massKg) || massKg <= 0) return null;
  const s = massKg / TREND_FILTER_DEFAULTS.referenceMassKg;
  return { qWKg: TREND_FILTER_DEFAULTS.qWKgPerDay * s, qRKgPerDay: TREND_FILTER_DEFAULTS.qRKgPerDayPerDay * s };
}

/** Balance-correction controller defaults (C4/D5-03): ±300 kcal/day, at most 100 kcal/day change per weekly decision. */
export const BALANCE_CORRECTION_BOUNDS = { maxAbsKcalPerDay: 300, maxStepKcalPerDecision: 100, label: 'controllerDefault' } as const;

/**
 * Apply the controller bounds to a requested correction given the previously applied one; reports saturation so the UI
 * can say "Correction at limit". A retry of the same decision must pass the same `previousAppliedKcal` (no reset).
 */
export function boundBalanceCorrection(requestedKcal: number, previousAppliedKcal: number): { appliedKcal: number; saturated: boolean; stepLimited: boolean } | null {
  if (!Number.isFinite(requestedKcal) || !Number.isFinite(previousAppliedKcal)) return null;
  const { maxAbsKcalPerDay: cap, maxStepKcalPerDecision: step } = BALANCE_CORRECTION_BOUNDS;
  const stepped = Math.min(previousAppliedKcal + step, Math.max(previousAppliedKcal - step, requestedKcal));
  const applied = Math.min(cap, Math.max(-cap, stepped));
  return { appliedKcal: applied, saturated: Math.abs(applied) >= cap && Math.abs(requestedKcal) > cap, stepLimited: stepped !== requestedKcal };
}

// =====================================================================================================================
// body composition, girth, blood pressure, ketones (D1-03, D5-07, D4-05, D2-08)
// =====================================================================================================================

export type BodyCompositionMethod = 'dxa' | 'bia' | 'skinfold' | 'navy' | 'rfm' | 'unknown';
export type GirthLandmark = 'iliacCrest' | 'umbilicus' | 'narrowest' | 'midpoint' | 'unknown';

/**
 * A body-composition reading as measured (D1-03/D5-07): method, device/session, actual time, optional scan fat mass and
 * scan mass, protocol and the two uncertainty components. Legacy readings keep `method: 'unknown'` and no scan mass.
 */
export interface BodyCompositionObservation {
  observationId: string;
  revision?: number;
  method: BodyCompositionMethod;
  device?: string;
  occurrence: OccurrenceTime;
  bodyFatPct?: number;
  scanFatMassKg?: number;
  scanMassKg?: number;
  protocol?: string;
  parents: readonly string[];
  repeatabilitySdPct?: number;
  systematicSdPct?: number;
  provenance: QuantityProvenance;
}

/**
 * Fat-mass observation from a scan (D5-07): prefer measured scan FM kg; percent-only converts as FM = pct·scanMass/100
 * only with a compatible measured scan mass; otherwise it stays a percent operator (never combined with a scale weight
 * taken at another time).
 */
export function fatMassObservation(o: Pick<BodyCompositionObservation, 'method' | 'bodyFatPct' | 'scanFatMassKg' | 'scanMassKg'>):
  | { kind: 'fatMassKg'; valueKg: number; operator: Extract<OperatorId, 'dxaFatMass' | 'deviceFatMass'> }
  | { kind: 'percentOnly'; pct: number; operator: OperatorId }
  | null {
  if (o.scanFatMassKg !== undefined && Number.isFinite(o.scanFatMassKg) && o.scanFatMassKg >= 0) return { kind: 'fatMassKg', valueKg: o.scanFatMassKg, operator: o.method === 'dxa' ? 'dxaFatMass' : 'deviceFatMass' };
  if (o.bodyFatPct === undefined || !Number.isFinite(o.bodyFatPct) || o.bodyFatPct < 0 || o.bodyFatPct > 100) return null;
  if (o.scanMassKg !== undefined && Number.isFinite(o.scanMassKg) && o.scanMassKg > 0) return { kind: 'fatMassKg', valueKg: (o.bodyFatPct * o.scanMassKg) / 100, operator: o.method === 'dxa' ? 'dxaFatMass' : 'deviceFatMass' };
  const operator: OperatorId = o.method === 'dxa' ? 'dxaBodyFat' : o.method === 'bia' ? 'biaBodyFat' : o.method === 'navy' ? 'navyBodyFat' : o.method === 'skinfold' ? 'skinfoldBodyFat' : 'scaleBodyFatWake';
  return { kind: 'percentOnly', pct: o.bodyFatPct, operator };
}

export interface BpReading {
  sbpMmHg: number;
  dbpMmHg: number;
  occurredAt: IsoInstant;
}

/**
 * One blood-pressure episode (D4-05): paired SBP/DBP readings with their actual measured time (separate from entry time),
 * method/setting/rest and relevant antihypertensive change dates. Sporadic single readings stay valid observations with
 * an incomplete-protocol status; individual readings remain safety inputs.
 */
export interface BloodPressureEpisode {
  episodeId: string;
  readings: readonly BpReading[];
  recordedAt?: IsoInstant;
  method?: 'homeCuff' | 'clinic' | 'ambulatory' | 'unknown';
  setting?: 'home' | 'clinic' | 'pharmacy' | 'other' | 'unknown';
  seatedRestMin?: number;
  arm?: 'left' | 'right' | 'unknown';
  /** Session of a home protocol, as the person tagged it. */
  timeOfDay?: 'morning' | 'evening' | 'other';
  medicationChangeDates?: readonly IsoDate[];
}

/** `paired` = at least two finite readings at distinct instants; anything else is a valid but incomplete-protocol episode. */
export function bpEpisodeStatus(e: BloodPressureEpisode): 'paired' | 'incompleteProtocol' {
  const ok = e.readings.filter((r) => Number.isFinite(r.sbpMmHg) && Number.isFinite(r.dbpMmHg) && Number.isFinite(Date.parse(r.occurredAt)));
  return new Set(ok.map((r) => Date.parse(r.occurredAt))).size >= 2 ? 'paired' : 'incompleteProtocol';
}

/**
 * Coverage of the optional guideline-compatible home protocol (D4-05): days with a paired morning and a paired evening
 * session; ≥ 3 such days = minimum, ≥ 7 = preferred. Days come from the episode's first reading's local date as written.
 */
export function bpSessionCoverage(episodes: readonly BloodPressureEpisode[]): { protocolDays: number; minimumMet: boolean; preferredMet: boolean } {
  const byDay = new Map<string, { morning: boolean; evening: boolean }>();
  for (const e of episodes) {
    if (bpEpisodeStatus(e) !== 'paired' || (e.timeOfDay !== 'morning' && e.timeOfDay !== 'evening')) continue;
    const day = e.readings[0]?.occurredAt.slice(0, 10);
    if (!day) continue;
    const d = byDay.get(day) ?? { morning: false, evening: false };
    d[e.timeOfDay] = true;
    byDay.set(day, d);
  }
  const protocolDays = [...byDay.values()].filter((d) => d.morning && d.evening).length;
  return { protocolDays, minimumMet: protocolDays >= 3, preferredMet: protocolDays >= 7 };
}

export type KetoneSpecimen = 'capillaryBlood' | 'venousBlood' | 'urine' | 'breath';

/** Only blood D-BHB maps to the endpoint operator; urine/breath readings are never converted into blood BHB (D2-08). */
export function ketoneOperatorFor(specimen: KetoneSpecimen | undefined): OperatorId | null {
  return specimen === 'capillaryBlood' || specimen === 'venousBlood' ? 'bhbEndpoint' : null;
}

// =====================================================================================================================
// kidney function quantities (D7-02)
// =====================================================================================================================

export type GfrQuantityKind = 'egfrIndexed' | 'gfrAbsolute' | 'creatinineClearance' | 'indexingUnconfirmed';

/**
 * Quantity kind from a printed unit (D7-02): an explicit /1.73 m² unit is indexed eGFR; bare mL/min is ambiguous
 * (`indexingUnconfirmed`) and is never staged or converted until the person/lab confirms it is absolute GFR.
 */
export function gfrQuantityFromUnit(unit: string | null | undefined): GfrQuantityKind {
  const u = (unit ?? '').replace(/\s+/g, '').toLowerCase();
  if (/1[.,]73/.test(u)) return 'egfrIndexed';
  return 'indexingUnconfirmed';
}

/** Mosteller BSA, m² = sqrt(height cm × weight kg / 3600) (a declared BSA method). */
export function mostellerBsaM2(heightCm: number, weightKg: number): number | null {
  if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg) || heightCm <= 0 || weightKg <= 0) return null;
  return Math.sqrt((heightCm * weightKg) / 3600);
}

/**
 * Indexed GFR from a confirmed absolute GFR (D7-02): GFR_indexed = GFR_absolute × 1.73 / BSA with sample-date height and
 * weight and the declared method (70 mL/min at BSA 2.2 m² → 55.045 mL/min/1.73 m²). Creatinine clearance and ambiguous
 * mL/min values are refused, as is anthropometry from another date.
 */
export function indexGfr(input: { valueMlMin: number; quantity: GfrQuantityKind; sampleDate: IsoDate; heightCm?: number; weightKg?: number; anthropometryDate?: IsoDate }):
  | { status: 'converted'; indexedMlMin173: number; bsaM2: number; bsaMethod: 'mosteller'; absoluteMlMin: number; anthropometry: { heightCm: number; weightKg: number; date: IsoDate } }
  | { status: 'refused'; reason: 'creatinineClearanceNotGfr' | 'indexingUnconfirmed' | 'alreadyIndexed' | 'anthropometryMissing' | 'anthropometryNotSampleDate' | 'nonFinite' } {
  if (!Number.isFinite(input.valueMlMin) || input.valueMlMin < 0) return { status: 'refused', reason: 'nonFinite' };
  if (input.quantity === 'creatinineClearance') return { status: 'refused', reason: 'creatinineClearanceNotGfr' };
  if (input.quantity === 'indexingUnconfirmed') return { status: 'refused', reason: 'indexingUnconfirmed' };
  if (input.quantity === 'egfrIndexed') return { status: 'refused', reason: 'alreadyIndexed' };
  if (input.heightCm === undefined || input.weightKg === undefined || !input.anthropometryDate) return { status: 'refused', reason: 'anthropometryMissing' };
  if (input.anthropometryDate !== input.sampleDate) return { status: 'refused', reason: 'anthropometryNotSampleDate' };
  const bsa = mostellerBsaM2(input.heightCm, input.weightKg);
  if (bsa === null) return { status: 'refused', reason: 'anthropometryMissing' };
  return {
    status: 'converted',
    indexedMlMin173: (input.valueMlMin * 1.73) / bsa,
    bsaM2: bsa,
    bsaMethod: 'mosteller',
    absoluteMlMin: input.valueMlMin,
    anthropometry: { heightCm: input.heightCm, weightKg: input.weightKg, date: input.anthropometryDate },
  };
}

// =====================================================================================================================
// lab sample eligibility (D7-06, D7-09)
// =====================================================================================================================

/** Minimum no-calorie interval for a fasting sample under the adopted guideline definition (D7-09). */
export const FASTING_SAMPLE_MIN_HOURS = 8;
/** HOMA-IR = glucose (mmol/L) × insulin (µU/mL) / 22.5 (descriptive surrogate, not a diagnostic threshold). */
export const HOMA_IR_DENOMINATOR = 22.5;

/**
 * Explicitly known context of one draw (D7-06), as recorded; absent = unknown, never assumed. Only a known illness or a
 * known prolonged-fast state changes HOMA interpretation; hard training and the hours since a fast ended are kept as
 * context and reject nothing.
 */
export interface LabSampleContext {
  /** The person was ill when the sample was drawn (no severity): an unresolved confounder for a routine basal HOMA. */
  illness?: boolean;
  hardTraining48h?: boolean;
  /** Hours since the last fast ended (the refeed context of the draw). */
  afterFastHours?: number;
  /** The draw was part of an explicit prolonged-fast protocol (e.g. a supervised multi-day fast). */
  prolongedFastProtocol?: boolean;
  /** Hours into a logged fast at the draw, when the draw falls inside one (from the person's fast log). */
  loggedFastHoursAtSample?: number;
}

/** One lab draw's facts, as known; absent = unknown (no same-draw assumption from a shared date). */
export interface LabSample {
  sampleId?: string;
  /** Draw instant as recorded (with its UTC offset when known); precision is what was written (minute, second, ms). */
  sampledAt?: IsoInstant;
  /** Local calendar date of the draw; an empty or malformed date is unknown, never a mismatch. */
  date: IsoDate;
  fastingHours?: number;
  fastingStatus?: 'fasting' | 'nonFasting' | 'unknown';
  exogenousInsulin?: boolean;
  /** The person confirmed this sample was drawn together with its partner. */
  confirmedPairWith?: string;
  /** (D7-06) context of the draw; absent = unknown (missing context alone never blocks a routine fasting panel). */
  sampleContext?: LabSampleContext;
}

export function fastingSampleEligibility(s: LabSample): 'eligible' | 'notFasting' | 'unknown' {
  if (s.fastingHours !== undefined && Number.isFinite(s.fastingHours)) return s.fastingHours >= FASTING_SAMPLE_MIN_HOURS ? 'eligible' : 'notFasting';
  if (s.fastingStatus === 'fasting') return 'eligible';
  if (s.fastingStatus === 'nonFasting') return 'notFasting';
  return 'unknown';
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ZONED = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * An instant as written: absolute ms when it carries a zone (otherwise its wall clock read as UTC, comparable only with
 * another zone-less instant) and the unit it was written to (minute, second or millisecond). Null when unparseable.
 */
function instantAsWritten(s: string | undefined): { ms: number; unitMs: number; zoned: boolean; wallDate: IsoDate } | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?/.exec(s);
  if (!m) return null;
  const zoned = ZONED.test(s);
  const ms = Date.parse(zoned ? s : `${s}Z`);
  if (!Number.isFinite(ms)) return null;
  return { ms, unitMs: m[5] ? 1 : m[4] ? 1000 : 60_000, zoned, wallDate: m[1]! };
}

/** Whether two draws' recorded occurrences can be the same draw, and on what basis it was decided (A1-034). */
export type OccurrenceConsistency = { status: 'consistent' | 'conflict'; basis: 'instant' | 'date' } | { status: 'unknown'; basis: 'none' };

/**
 * Occurrence consistency of two samples (A1-034): two instants on a comparable clock (both with a zone, or both without)
 * are the same draw only if they agree at the coarser of the two written precisions (no matching window is invented);
 * otherwise two known local calendar dates must be equal. An empty/malformed date and a missing instant stay unknown,
 * so equivalent instants written in different offsets or with different precision are never a conflict.
 */
export function occurrenceConsistency(a: Pick<LabSample, 'date' | 'sampledAt'>, b: Pick<LabSample, 'date' | 'sampledAt'>): OccurrenceConsistency {
  const ia = instantAsWritten(a.sampledAt);
  const ib = instantAsWritten(b.sampledAt);
  if (ia && ib && ia.zoned === ib.zoned) {
    const u = Math.max(ia.unitMs, ib.unitMs);
    return { status: Math.floor(ia.ms / u) === Math.floor(ib.ms / u) ? 'consistent' : 'conflict', basis: 'instant' };
  }
  const da = ISO_DATE.test(a.date) ? a.date : ia?.wallDate;
  const db = ISO_DATE.test(b.date) ? b.date : ib?.wallDate;
  if (da && db) return { status: da === db ? 'consistent' : 'conflict', basis: 'date' };
  return { status: 'unknown', basis: 'none' };
}

/** Whether a sample claims to be the same draw as another: a shared sample id, or a pairing either side confirmed. */
export function drawIdentityLinked(a: Pick<LabSample, 'sampleId' | 'confirmedPairWith'>, b: Pick<LabSample, 'sampleId' | 'confirmedPairWith'>): boolean {
  return (a.sampleId !== undefined && a.sampleId === b.sampleId) || (b.sampleId !== undefined && a.confirmedPairWith === b.sampleId) || (a.sampleId !== undefined && b.confirmedPairWith === a.sampleId);
}

/** Why a pair is not one eligible fasting draw (D7-06; A1-034 adds `samplingConflict`). */
export type PairReason = 'pairingUnknown' | 'samplingConflict' | 'fastingUnknown' | 'notFasting' | 'exogenousInsulin';

/** Typed pair eligibility for HOMA and repeat-pair rules (D7-06), shared by rules and engine calibration. */
export interface PairEligibility {
  eligible: boolean;
  reasons: ReadonlyArray<PairReason>;
}

/**
 * Same-draw fasting pair (D7-06, A1-034): a shared id or a confirmed pairing establishes the draw only when the known
 * occurrences agree — a February glucose and an October insulin that reuse one id are `samplingConflict`, as are two
 * different recorded instants on one date. Unknown times with a consistent identity stay usable. Both samples must be
 * fasting by the general ≥ 8 h definition and neither on exogenous insulin.
 */
export function pairedFastingEligibility(glucose: LabSample, insulin: LabSample): PairEligibility {
  const reasons: PairReason[] = [];
  if (!drawIdentityLinked(glucose, insulin)) reasons.push('pairingUnknown');
  else if (occurrenceConsistency(glucose, insulin).status === 'conflict') reasons.push('samplingConflict');
  for (const s of [glucose, insulin]) {
    const f = fastingSampleEligibility(s);
    if (f === 'notFasting' && !reasons.includes('notFasting')) reasons.push('notFasting');
    if (f === 'unknown' && !reasons.includes('fastingUnknown')) reasons.push('fastingUnknown');
  }
  if (glucose.exogenousInsulin || insulin.exogenousInsulin) reasons.push('exogenousInsulin');
  return { eligible: reasons.length === 0, reasons };
}

/**
 * The partner draw of `target` among `candidates` (A1-034): only candidates linked by identity whose occurrence does not
 * conflict, preferring an instant match, then a date match, then unknown occurrence; ties keep the caller's order
 * (never simply the last-entered id match). Undefined when none is consistent.
 */
export function selectDrawPartner<T extends LabSample>(target: LabSample, candidates: readonly T[]): T | undefined {
  const rank = (c: OccurrenceConsistency): number => (c.status === 'conflict' ? -1 : c.basis === 'instant' ? 2 : c.basis === 'date' ? 1 : 0);
  let best: { c: T; r: number } | undefined;
  for (const c of candidates) {
    if (!drawIdentityLinked(c, target)) continue;
    const r = rank(occurrenceConsistency(c, target));
    if (r >= 0 && (!best || r > best.r)) best = { c, r };
  }
  return best?.c;
}

/**
 * A multi-day fast, h (A1-047): a draw after more than one full day without calories is inside a multi-day fast — the
 * planner's own boundary between a one-day fast and a multi-day water fast. A definition of "not an overnight basal
 * sample", not a HOMA validity limit, an FPG cutoff or a safety tier; durations up to it are not claimed validated.
 */
export const MULTI_DAY_FAST_HOURS = 24;

/** Why a same-draw fasting pair is not an ordinary routine basal HOMA (A1-047). */
export type HomaContextReason = 'illnessUnresolved' | 'prolongedFast';

/**
 * HOMA routine-basal context of one draw (A1-047): a known illness is an unresolved confounder; a known prolonged-fast
 * protocol, a logged fast past one full day at the draw, or a fasting duration past one full day is a prolonged fast.
 * Unknown context is no reason (never a forced screening).
 */
export function homaContextReasons(s: Pick<LabSample, 'fastingHours' | 'sampleContext'>): HomaContextReason[] {
  const out: HomaContextReason[] = [];
  const c = s.sampleContext;
  if (c?.illness === true) out.push('illnessUnresolved');
  const longer = (h: number | undefined): boolean => h !== undefined && Number.isFinite(h) && h > MULTI_DAY_FAST_HOURS;
  if (c?.prolongedFastProtocol === true || longer(c?.loggedFastHoursAtSample) || longer(s.fastingHours)) out.push('prolongedFast');
  return out;
}

/**
 * HOMA eligibility (A1-047): the general same-draw fasting pair (≥ 8 h, unchanged for FPG) plus a routine-basal context
 * layer. `eligible` = the pair is eligible AND the context is routine; only that drives HOMA preferences, objectives or a
 * hepatic calibration. A known illness (`confounded`) or prolonged fast (`nonroutine`) keeps the pair (`pair.eligible`)
 * for a separately labelled contextual ratio; raw glucose and insulin are never changed.
 */
export interface HomaEligibility {
  eligible: boolean;
  reasons: ReadonlyArray<PairReason | HomaContextReason>;
  pair: PairEligibility;
  context: 'routine' | 'confounded' | 'nonroutine';
  contextReasons: ReadonlyArray<HomaContextReason>;
}

export function homaEligibility(glucose: LabSample, insulin: LabSample): HomaEligibility {
  const pair = pairedFastingEligibility(glucose, insulin);
  const contextReasons = [...new Set([...homaContextReasons(glucose), ...homaContextReasons(insulin)])].sort() as HomaContextReason[];
  const context = contextReasons.includes('illnessUnresolved') ? 'confounded' : contextReasons.length > 0 ? 'nonroutine' : 'routine';
  return { eligible: pair.eligible && contextReasons.length === 0, reasons: [...pair.reasons, ...contextReasons], pair, context, contextReasons };
}

/** HOMA-IR only from an eligible pair; otherwise null (shown as "Pairing unknown" / "Fasting unknown"). */
export function homaIr(glucoseMmolL: number, insulinUuMl: number, eligibility: Pick<PairEligibility, 'eligible'>): number | null {
  if (!eligibility.eligible || !Number.isFinite(glucoseMmolL) || !Number.isFinite(insulinUuMl) || glucoseMmolL <= 0 || insulinUuMl < 0) return null;
  return (glucoseMmolL * insulinUuMl) / HOMA_IR_DENOMINATOR;
}

/**
 * The arithmetic glucose × insulin / 22.5 of a same-draw fasting pair with its interpretation label (A1-047):
 * `routineBasal` only for a routine context; `contextual` (shown separately, never an objective, preference or
 * calibration input) for a known illness or prolonged fast. Null when the pair itself is not eligible.
 */
export function homaDescriptiveRatio(glucoseMmolL: number, insulinUuMl: number, h: HomaEligibility): { value: number; label: 'routineBasal' | 'contextual'; contextReasons: ReadonlyArray<HomaContextReason> } | null {
  const v = homaIr(glucoseMmolL, insulinUuMl, h.pair);
  return v === null ? null : { value: v, label: h.context === 'routine' ? 'routineBasal' : 'contextual', contextReasons: h.contextReasons };
}

// =====================================================================================================================
// medication chronology as of a date (D7-06, D7-09; A1-063)
// =====================================================================================================================

/** A dated medication class change as recorded (immutable); `agent` (drug identity), when known, separates same-class drugs. */
export interface DatedMedicationChange {
  id?: string;
  medicationClass: string;
  change: 'start' | 'stop' | 'doseChange';
  date: IsoDate;
  agent?: string;
}

/** Current medication screening for the asked classes, as of its date (`undisclosed` = the answer was withheld). */
export interface MedicationScreen {
  status: 'active' | 'none' | 'undisclosed';
  asOf: IsoDate;
}

export type MedicationExposure = 'active' | 'notActive' | 'unknown';
export type MedicationStateReason =
  | 'noRecordedChange'
  | 'activeCourse'
  | 'stoppedBefore'
  | 'impliedEarlierCourse'
  | 'ambiguousSameClass'
  | 'changeOnDate'
  | 'screenActive'
  | 'screenNone'
  | 'screenConflict'
  | 'screenActiveLater'
  | 'screenUndisclosed';

export interface MedicationStateAt {
  exposure: MedicationExposure;
  reasons: MedicationStateReason[];
  /** Latest recorded change on or before the date, or null. */
  lastChange: DatedMedicationChange | null;
  /** Recorded changes after the date: ignored for this state (a future event never changes an earlier status). */
  laterChanges: number;
}

const classSet = (classes: Iterable<string>): ReadonlySet<string> => (classes instanceof Set ? classes : new Set(classes));

/**
 * Exposure after ordered changes, per agent (unidentified drugs of one class share a course counter). A second unidentified
 * start while a course is open may be a second drug of the class or a repeated record: a later stop then leaves the class
 * `unknown` (it is never assumed to clear the whole class) until another stop, start or dose change resolves it.
 */
function exposureFrom(changes: readonly DatedMedicationChange[]): { exposure: MedicationExposure; reasons: MedicationStateReason[] } {
  const reasons = new Set<MedicationStateReason>();
  const courses = new Map<string, { depth: number; ambiguous: boolean; uncertain: boolean }>();
  for (const c of changes) {
    const key = `${c.medicationClass}:${c.agent ?? '?'}`;
    const k = courses.get(key) ?? { depth: 0, ambiguous: false, uncertain: false };
    if (c.change === 'start') {
      if (k.depth >= 1 && c.agent === undefined) k.ambiguous = true;
      k.depth = c.agent === undefined ? k.depth + 1 : 1;
      k.uncertain = false;
    } else if (c.change === 'doseChange') {
      if (k.depth === 0) {
        reasons.add('impliedEarlierCourse');
        k.depth = 1;
      }
      k.uncertain = false;
    } else {
      if (k.depth === 0) reasons.add('impliedEarlierCourse');
      k.depth = Math.max(0, k.depth - 1);
      if (k.depth === 0) {
        k.ambiguous = false;
        k.uncertain = false;
      } else if (k.ambiguous) k.uncertain = true;
    }
    courses.set(key, k);
  }
  const ks = [...courses.values()];
  const active = ks.some((k) => k.depth >= 1 && !k.uncertain);
  const unknown = !active && ks.some((k) => k.depth >= 1 && k.uncertain);
  if (active) reasons.add('activeCourse');
  else if (unknown) reasons.add('ambiguousSameClass');
  else if (changes.length > 0) reasons.add('stoppedBefore');
  else reasons.add('noRecordedChange');
  return { exposure: active ? 'active' : unknown ? 'unknown' : 'notActive', reasons: [...reasons] };
}

/**
 * Medication-class exposure as of the END of `asOf` from ordered start/stop/dose-change events (A1-063): events after the
 * date are ignored; a change on the date itself (order within the day unknown) makes the exposure `unknown` unless the
 * state is the same either side. A current screen applies from its own date: `active` is an independent fact (it is
 * never cleared by the history), `none` resolves an ambiguous history but conflicts with a course recorded as still open
 * before it (`unknown`), `undisclosed` leaves a not-active history unknown. A current `active` screen dated after `asOf`
 * with no recorded start makes a past not-active state unknown. No washout duration is assumed.
 */
export function medicationStateAt(changes: readonly DatedMedicationChange[], classes: Iterable<string>, asOf: IsoDate, screen?: MedicationScreen): MedicationStateAt {
  const want = classSet(classes);
  const rel = changes
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => want.has(c.medicationClass) && ISO_DATE.test(c.date))
    .sort((a, b) => (a.c.date < b.c.date ? -1 : a.c.date > b.c.date ? 1 : a.idx - b.idx))
    .map(({ c }) => c);
  const before = rel.filter((c) => c.date < asOf);
  const through = rel.filter((c) => c.date <= asOf);
  const later = rel.length - through.length;
  const pre = exposureFrom(before);
  const post = exposureFrom(through);
  const reasons = new Set<MedicationStateReason>(post.reasons);
  let exposure: MedicationExposure = post.exposure;
  if (through.length > before.length && pre.exposure !== post.exposure) {
    exposure = 'unknown';
    reasons.add('changeOnDate');
  }
  const lastChange = through[through.length - 1] ?? null;
  if (screen && ISO_DATE.test(screen.asOf)) {
    if (screen.asOf <= asOf) {
      if (screen.status === 'active') {
        exposure = 'active';
        reasons.add('screenActive');
      } else if (screen.status === 'undisclosed') {
        if (exposure !== 'active') {
          exposure = 'unknown';
          reasons.add('screenUndisclosed');
        }
      } else {
        const openAtScreen = exposureFrom(rel.filter((c) => c.date <= screen.asOf)).exposure;
        const changedSince = rel.some((c) => c.date > screen.asOf && c.date <= asOf);
        if (!changedSince && openAtScreen === 'active') {
          exposure = 'unknown';
          reasons.add('screenConflict');
        } else if (!changedSince) {
          exposure = 'notActive';
          reasons.add('screenNone');
        }
      }
    } else if (screen.status === 'active' && exposure === 'notActive' && !rel.some((c) => c.date > asOf && c.date <= screen.asOf && c.change !== 'stop')) {
      exposure = 'unknown';
      reasons.add('screenActiveLater');
    } else if (screen.status === 'undisclosed' && exposure === 'notActive') {
      exposure = 'unknown';
      reasons.add('screenUndisclosed');
    }
  }
  return { exposure, reasons: [...reasons], lastChange, laterChanges: later };
}

/** Whole days from `a` to `b` (ISO dates), or null when either is malformed. */
function isoDaysBetween(a: IsoDate, b: IsoDate): number | null {
  if (!ISO_DATE.test(a) || !ISO_DATE.test(b)) return null;
  const t = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

/** Medication context of a baseline-to-forecast comparison (A1-063). */
export interface MedicationChronology {
  /** Exposure as of the baseline sample's date. */
  atBaseline: MedicationStateAt;
  /** Recorded changes on or after the baseline date and before the run end (a change past the horizon cannot affect this run). */
  changesSinceBaseline: DatedMedicationChange[];
  /**
   * First run day (0 = `runStart`) from which a glucose response is not attributable to the plan: 0 when the class is
   * active or unknown at the baseline or changed between the baseline and the run start; the day of the first change
   * inside the run otherwise; null when unaffected (e.g. a stop before a newer baseline, or a start after the horizon).
   */
  affectedFromDay: number | null;
  reason: 'activeAtBaseline' | 'unknownAtBaseline' | 'changeSinceBaseline' | null;
}

/**
 * As-of medication chronology for a run (A1-063): the exposure at the baseline sample and the treatment changes from
 * the baseline through the horizon, so a future event never alters an earlier prefix and a remote stop followed by a
 * newer baseline is not current exposure. Pure: explicitly dated events and the current screen only.
 */
export function medicationChronology(i: { changes: readonly DatedMedicationChange[]; classes: Iterable<string>; runStart: IsoDate; runDays?: number; baselineDate?: IsoDate; screen?: MedicationScreen }): MedicationChronology {
  const want = classSet(i.classes);
  const baseline = i.baselineDate && ISO_DATE.test(i.baselineDate) ? i.baselineDate : i.runStart;
  const atBaseline = medicationStateAt(i.changes, want, baseline, i.screen);
  const inRun = (d: IsoDate): boolean => {
    if (i.runDays === undefined) return true;
    const k = isoDaysBetween(i.runStart, d);
    return k !== null && k < i.runDays;
  };
  const changesSinceBaseline = i.changes
    .filter((c) => want.has(c.medicationClass) && ISO_DATE.test(c.date) && c.date >= baseline && inRun(c.date))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (atBaseline.exposure !== 'notActive') return { atBaseline, changesSinceBaseline, affectedFromDay: 0, reason: atBaseline.exposure === 'active' ? 'activeAtBaseline' : 'unknownAtBaseline' };
  const first = changesSinceBaseline[0];
  if (!first) return { atBaseline, changesSinceBaseline, affectedFromDay: null, reason: null };
  return { atBaseline, changesSinceBaseline, affectedFromDay: Math.max(0, isoDaysBetween(i.runStart, first.date) ?? 0), reason: 'changeSinceBaseline' };
}
