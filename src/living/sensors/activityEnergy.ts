/**
 * Energy of one bout (`act-energy/1`, energy SPEC §V2.4, RESEARCH E4, E5, III.A-B, DECISION D2).
 *
 * Every estimator that MAY apply to the activity type (V1 `activityTraitsOf(...).estimators`, in booking order) is
 * computed; the FIRST eligible one is booked. Estimators are never averaged (correlated errors, RESEARCH E7):
 *  1. `reported`   a user override, with its provenance.
 *  2. `power`      a verified external-work source: stated efficiency → rest + P/η (`power-eff/1`), else ACSM leg ergometry
 *                  (`acsm-cycle/1`, 50-200 W). Leg cycle ergometers only: air-bike, rower and arm-ergometer display watts
 *                  are not validated metabolic work and are never eligible without a calibration.
 *  3. `speedGrade` V1 `speedGradeEstimate` with treadmill belt speed, GPS moving speed or (r063 S16/A19) accepted Health
 *                  Connect per-minute speed (`hcSpeed`) (walk/run gait only; outdoor cycling from GPS or Health Connect
 *                  speed is never eligible; the estimate's evidence says `speedNotEligibleForType`). Unknown grade is a
 *                  declared level assumption, wider envelope.
 *  4. `personalHr` reserved: no personal calibration exists at launch.
 *  5. `keytel`     Keytel 2005 no-fitness HR regression, only when D2 is on (default ON, behind `d2Keytel`):
 *                  in domain for steady walk, run, treadmill and leg cycling; eligible with `outOfDomain` and ±50 % for the
 *                  air bike and elliptical (the owner asked for HR-based air-bike calories); never for intervals/HIIT,
 *                  team, racket and dance sports, circuit, resistance, gripping/isometric work (mudgar, gada, dumbbell,
 *                  kettlebell), yoga, sleep or rest (V1 `hrEnergyEligible: 'never'`). Needs the coefficient set (sex),
 *                  supported HR ≥ 60 % of moving time and median supported HR ≥ 90 bpm (P, engineering policy only).
 *                  Integrated over supported seconds only; unsupported moving seconds get the MET estimate and the bout
 *                  reports both parts. A manual log with only a stated average HR is eligible with `manualAverageHr`, ±50 %.
 *                  With D2 off the MET estimate is booked and Keytel stays a comparison.
 *  6. `met`        the catalogue MET matched by intensity class (stated class, talk test, or a rating on the generic 0-10
 *                  relative-effort scale; Borg CR10 and RIR-RPE do not classify, engine A1-062): light → the range's low
 *                  end, moderate → the catalogue value, vigorous → the range's high end (P); else the catalogue default.
 *                  ±30 % when matched to a non-analog row with a known intensity, ±50 % for analog or unspecified intensity.
 *
 * The booked G goes through the shared ledger (`boutCost`, SPEC §1.3: R, A, D, I) and V1 `realisedEngineDose` (the
 * equivalent MET + realised gross that V3 writes into the session, §1.4: one estimate, three consumers). Cost provenance
 * is always `estimated` (notes C05); input provenance is a separate field. Vendor kcal (ring, Gauge, Health Connect) are
 * comparisons only and are never booked.
 *
 * Warrants:
 *  - Keytel: empirical-formal B within its sample (n = 115, 18-45 y, 47-120 kg, steady treadmill/cycle; R² .73; independent
 *    validation r .77, bias +1.5 kcal/min, agreement limits −3.0..+6.0 kcal/min), C on transfer to a ring and to other
 *    modalities (R² .28 in a Mozambique field test). Causally coherent A for the HR–VO2 link in steady aerobic work only.
 *  - ACSM / Compendium: empirical-formal B within stated domains (V1). The 4.184 kJ/kcal conversion is analytically true A.
 *  - Envelopes are product scenarios (SPEC §1.5), not confidence intervals; the selection order is causally coherent B.
 * Failure modes: heat, dehydration, fever, stress and HR-altering medication decouple HR from oxygen demand; gripping and
 * upper-body work raise HR without the matching VO2. Calibration: same-person repeat bouts against indirect calorimetry.
 */
import { boutCost, type BoutCost } from '@/engine/core/exerciseCost';
import { ACTIVITY_PARAMS } from '@/engine/model/activity/params';
import { healthClassFromRating, healthClassFromTalkTest, realisedEngineDose, type HealthClassK, type RealisedDose } from '@/engine/model/activity/equations';
import type { EffortScale, SessionHrSummary } from '@/engine/types/schedule';
import { speedGradeEstimate } from '@/catalogues/stimulus';
import type { ActivityEstimator, ActivityTraits, ExerciseRecord } from '@/catalogues/types';
import { SEED_EXERCISES } from '@/content/catalogues/exercises';
import { activityTraitsOf } from '@/content/catalogues/activityTypes';
import { contentHash, type ExerciseCostBreakdown } from '@/lib/bodyContracts';
import {
  SENSOR_VERSIONS,
  clipSegments,
  isFiniteNum,
  median,
  scenario,
  sp,
  sumEnvelopes,
  type CoefficientSex,
  type Envelope,
  type HrSegment,
  type IntensityClass,
  type Interval,
  type UncertaintyKind,
} from './types';

const param = (id: string): number => {
  const d = ACTIVITY_PARAMS.find((p) => p.id === id);
  if (!d) throw new Error(`missing activity parameter ${id}`);
  return d.value;
};

/** Engine registry values (activity.health*, WHO 2020 bounds) and the displaced lifestyle prior (activity.displacedBaseline). */
export const HEALTH_CLASS_K: HealthClassK = {
  relModerateMin: param('activity.healthRelModerateMin'),
  relVigorousMin: param('activity.healthRelVigorousMin'),
  absModerateMet: param('activity.healthAbsModerateMet'),
  absVigorousMet: param('activity.healthAbsVigorousMet'),
  vigorousWeight: param('activity.healthVigorousWeight'),
};
export const DISPLACED_BASELINE = param('activity.displacedBaseline');

const BY_ID: ReadonlyMap<string, ExerciseRecord> = new Map(SEED_EXERCISES.map((e) => [e.id, e]));

/** A catalogue record by id (the seed catalogue; pass a user record through `exercise` instead). */
export const exerciseRecordOf = (id: string): ExerciseRecord | undefined => BY_ID.get(id);

// ---------------------------------------------------------------- Keytel 2005

/** Keytel no-fitness model, gross kJ/min (male: −55.0969 + 0.6309·HR + 0.1988·m + 0.2017·age). */
export function keytelKjPerMin(sex: 'male' | 'female', hrBpm: number, massKg: number, ageY: number): number {
  return sex === 'male'
    ? -55.0969 + 0.6309 * hrBpm + 0.1988 * massKg + 0.2017 * ageY
    : // the female mass coefficient is NEGATIVE (Keytel 2005 Table, RESEARCH E5)
      -20.4022 + 0.4472 * hrBpm - 0.1263 * massKg + 0.074 * ageY;
}

/** Keytel gross kcal/min = kJ/min ÷ 4.184 (never the kJ value). Negative predictions (low HR) are floored at 0. */
export const keytelKcalPerMin = (sex: 'male' | 'female', hrBpm: number, massKg: number, ageY: number): number =>
  Math.max(0, keytelKjPerMin(sex, hrBpm, massKg, ageY)) / sp('kjPerKcal');

// ---------------------------------------------------------------- inputs and outputs

export interface ActivityEnergyInput {
  exerciseId: string;
  /** The record (a user catalogue item); default: the seed catalogue entry of `exerciseId`. */
  exercise?: ExerciseRecord;
  /** Booked (moving) minutes of the bout. */
  durationMin: number;
  /** Body mass dated to the bout, kg. */
  massKg: number;
  ageY: number | null;
  /** Coefficient set for Keytel; null = unknown (Keytel unavailable, never silently "male"). */
  sex: CoefficientSex;
  /** The person's RMR, kcal/d (engine); null = standard 1-MET rest. */
  rmrKcalPerDay: number | null;
  /** activity.displacedBaseline (default 0.2 × RMR/min). */
  displacedFracOfRmr?: number | null;
  /** DECISION D2 (default true): book Keytel in its domain. False keeps it as a comparison. */
  d2Keytel?: boolean;
  /** False for intervals/HIIT or any non-steady bout (Keytel never eligible). Default: steady unless the type says HIIT. */
  steady?: boolean;
  reported?: { grossKcal: number; provenance: string };
  power?: { avgW: number; verified: boolean; efficiency?: number | null };
  /** `hc` (r063 S16/A19): Health Connect per-minute speed accepted over the bout (measured, not a manual entry). */
  speed?: { kmh: number; gradeFrac?: number | null; source: 'belt' | 'gps' | 'hc' };
  /** Supported HR (`hr-support/1`) over the bout window. */
  hr?: { segments: readonly HrSegment[]; window: Interval; pauses?: readonly Interval[] };
  /** A manual log's stated average HR (no samples). */
  manualAvgHr?: number | null;
  intensity?: { class?: IntensityClass; talkTest?: 'canSing' | 'talkNotSing' | 'fewWords' | 'fullSentences' | 'unknown'; rating?: number; ratingScale?: EffortScale };
  /** Device kcal of the same bout: comparisons only. */
  vendor?: ReadonlyArray<{ source: string; kcal: number; method?: string }>;
  /** Opaque source reference (ids and revisions) carried into the cost's `inputsRef`. */
  inputsRef?: string;
}

export interface EnergyEstimate {
  estimator: ActivityEstimator;
  grossKcal: number;
  method: ExerciseCostBreakdown['method'];
  version: string;
  envelope: Envelope;
  uncertaintyKind: UncertaintyKind;
  domainFlags: string[];
  /** May be booked (false: computed as a comparison only, e.g. Keytel with D2 off). */
  bookable: boolean;
  /** Keytel with unsupported moving time: the HR part and the MET part. */
  parts?: { hrKcal: number; hrSupportedS: number; metKcal: number; metS: number };
  provenance?: string;
}

export interface ActivityEnergy {
  version: typeof SENSOR_VERSIONS.activityEnergy;
  exerciseId: string;
  traits: ActivityTraits;
  booked: EnergyEstimate;
  /** Every other computed estimate (never booked, never averaged). */
  comparisons: EnergyEstimate[];
  /** Estimators that may apply to the type but could not be computed, with the reason. */
  rejected: Array<{ estimator: ActivityEstimator; reason: string }>;
  vendor: Array<{ source: string; kcal: number; method?: string; label: 'comparison, never booked' }>;
  /** Shared ledger terms of the booked gross (G, R, A, D, I), provenance `estimated`. */
  cost: BoutCost;
  /** What V3 writes into the session (`met`, `realisedGrossKcal`); null when the inputs are not positive. */
  engineDose: RealisedDose | null;
  /** Inert HR summary for the session (engine `SessionHrSummary`), when HR exists. */
  hrSummary: SessionHrSummary | null;
  status: 'inferred';
}

const KEYTEL_VERSION = SENSOR_VERSIONS.keytel;

// ---------------------------------------------------------------- estimators

/** Intensity class of the input (stated, talk test, or a generic 0-10 rating; CR10/RIR-RPE leave it unknown). */
export function intensityClassOf(i: ActivityEnergyInput['intensity']): IntensityClass {
  if (!i) return 'unknown';
  if (i.class && i.class !== 'unknown') return i.class;
  if (i.talkTest) {
    const c = healthClassFromTalkTest(i.talkTest);
    if (c !== 'unknown') return c;
  }
  return healthClassFromRating(i.rating, i.ratingScale, HEALTH_CLASS_K);
}

/** The matched catalogue MET and its envelope half-width (SPEC V2.4(6)). */
export function matchedMet(ex: ExerciseRecord, cls: IntensityClass): { met: number; half: number; flags: string[] } {
  const [lo, hi] = ex.energy.metRange;
  const met = cls === 'light' ? lo : cls === 'vigorous' ? hi : ex.energy.metGross;
  const analog = ex.energy.analog === true;
  const flags: string[] = [];
  if (analog) flags.push('analogMet');
  if (cls === 'unknown') flags.push('intensityUnspecified');
  return { met, half: analog || cls === 'unknown' ? sp('envWide') : sp('envMatchedMet'), flags };
}

const metKcal = (met: number, massKg: number, minutes: number): number => (met * 3.5 * 5 * massKg * minutes) / 1000;

function metEstimate(ex: ExerciseRecord, i: ActivityEnergyInput, minutes = i.durationMin): EnergyEstimate {
  const { met, half, flags } = matchedMet(ex, intensityClassOf(i.intensity));
  const g = metKcal(met, i.massKg, minutes);
  return { estimator: 'met', grossKcal: g, method: 'compendiumMet', version: 'compendium-met/1', envelope: scenario(g, half), uncertaintyKind: 'scenario', domainFlags: flags, bookable: true };
}

function restKcalPerMin(i: ActivityEnergyInput): number {
  return isFiniteNum(i.rmrKcalPerDay) && i.rmrKcalPerDay > 0 ? i.rmrKcalPerDay / 1440 : metKcal(1, i.massKg, 1);
}

function powerEstimate(i: ActivityEnergyInput): EnergyEstimate | string {
  const p = i.power;
  if (!p) return 'noPower';
  if (!p.verified) return 'powerNotVerified';
  if (!isFiniteNum(p.avgW) || p.avgW <= 0) return 'noPower';
  const eta = p.efficiency;
  if (isFiniteNum(eta) && eta > 0 && eta < 1) {
    const g = (restKcalPerMin(i) + (p.avgW * 60) / (4184 * eta)) * i.durationMin;
    return { estimator: 'power', grossKcal: g, method: 'power', version: SENSOR_VERSIONS.powerEfficiency, envelope: scenario(g, sp('envSpeedOrPower')), uncertaintyKind: 'scenario', domainFlags: ['statedEfficiency'], bookable: true };
  }
  const e = speedGradeEstimate({ gait: 'legCycleErgometer', massKg: i.massKg, durationMin: i.durationMin, powerW: p.avgW });
  if (!e) return 'powerOutsideDomain';
  return { estimator: 'power', grossKcal: e.grossKcal, method: 'acsm', version: e.version, envelope: e.envelope, uncertaintyKind: 'scenario', domainFlags: [...e.domainFlags], bookable: true };
}

function speedGradeEst(ex: ExerciseRecord, traits: ActivityTraits, i: ActivityEnergyInput): EnergyEstimate | string {
  const s = i.speed;
  if (!s || !isFiniteNum(s.kmh) || s.kmh <= 0) return 'noSpeed';
  const gait = ex.cardioModality === 'walk' ? 'walk' : ex.cardioModality === 'run' ? 'run' : null;
  if (gait === null) return 'notGait';
  const e = speedGradeEstimate({
    gait,
    massKg: i.massKg,
    durationMin: i.durationMin,
    speedKmh: s.kmh,
    gradeFrac: s.gradeFrac ?? null,
    treadmill: traits.treadmill || s.source === 'belt',
    jogging: gait === 'run',
  });
  if (!e) return 'speedOutsideDomain';
  const flags = [...e.domainFlags, ...(s.source === 'gps' ? ['gpsMovingSpeed'] : s.source === 'hc' ? ['hcSpeed'] : [])];
  return { estimator: 'speedGrade', grossKcal: e.grossKcal, method: e.method, version: e.version, envelope: e.envelope, uncertaintyKind: 'scenario', domainFlags: flags, bookable: true };
}

function keytelEstimate(ex: ExerciseRecord, traits: ActivityTraits, i: ActivityEnergyInput): EnergyEstimate | string {
  if (traits.hrEnergyEligible === 'never') return 'neverEligible';
  const steady = i.steady ?? ex.cardioModality !== 'hiit';
  if (!steady) return 'notSteady';
  if (i.sex !== 'male' && i.sex !== 'female') return 'coefficientSetUnknown';
  if (!isFiniteNum(i.ageY) || i.ageY <= 0) return 'ageUnknown';
  const outside = i.ageY < sp('keytelAgeLo') || i.ageY > sp('keytelAgeHi') || i.massKg < sp('keytelMassLo') || i.massKg > sp('keytelMassHi');
  const flags: string[] = [];
  if (traits.hrEnergyEligible === 'outOfDomain') flags.push('outOfDomain');
  if (outside) flags.push('outsideKeytelSample');
  const half = flags.length > 0 ? sp('envWide') : sp('envKeytel');
  const bookable = i.d2Keytel !== false;
  const movingS = i.durationMin * 60;
  if (i.hr && i.hr.segments.length > 0) {
    const segs = clipSegments(i.hr.segments, i.hr.window, i.hr.pauses ?? []);
    let supS = 0;
    let kcal = 0;
    for (const s of segs) {
      const d = (s.end - s.start) / 1000;
      supS += d;
      kcal += (keytelKcalPerMin(i.sex, s.bpm, i.massKg, i.ageY) * d) / 60;
    }
    supS = Math.min(supS, movingS);
    if (movingS <= 0 || supS / movingS < sp('keytelMinCoverage')) return 'hrCoverageLow';
    // the median of the supported samples (each segment is one sample's support)
    const med = median(segs.map((s) => s.bpm));
    if (med === null || med < sp('keytelMinMedianBpm')) return 'hrMedianLow';
    const metS = Math.max(0, movingS - supS);
    const met = metS > 0 ? metEstimate(ex, i, metS / 60) : null;
    if (met) flags.push('mixedWithMet');
    const env = sumEnvelopes([scenario(kcal, half), ...(met ? [met.envelope] : [])]);
    const g = kcal + (met?.grossKcal ?? 0);
    return {
      estimator: 'keytel',
      grossKcal: g,
      method: 'hr',
      version: KEYTEL_VERSION,
      envelope: env,
      uncertaintyKind: 'scenario',
      domainFlags: flags,
      bookable,
      parts: { hrKcal: kcal, hrSupportedS: supS, metKcal: met?.grossKcal ?? 0, metS },
    };
  }
  if (isFiniteNum(i.manualAvgHr) && i.manualAvgHr > 0) {
    if (i.manualAvgHr < sp('keytelMinMedianBpm')) return 'hrMedianLow';
    const g = keytelKcalPerMin(i.sex, i.manualAvgHr, i.massKg, i.ageY) * i.durationMin;
    return { estimator: 'keytel', grossKcal: g, method: 'hr', version: KEYTEL_VERSION, envelope: scenario(g, sp('envWide')), uncertaintyKind: 'scenario', domainFlags: [...flags, 'manualAverageHr'], bookable };
  }
  return 'noHr';
}

function hrSummaryOf(i: ActivityEnergyInput): SessionHrSummary | null {
  if (i.hr && i.hr.segments.length > 0) {
    const segs = clipSegments(i.hr.segments, i.hr.window, i.hr.pauses ?? []);
    let s = 0;
    let w = 0;
    let max = 0;
    for (const g of segs) {
      const d = (g.end - g.start) / 1000;
      s += d;
      w += d * g.bpm;
      max = Math.max(max, g.bpm);
    }
    if (s > 0) return { avgBpm: w / s, maxBpm: max, supportedS: s, method: 'hr-support/1' };
  }
  if (isFiniteNum(i.manualAvgHr) && i.manualAvgHr > 0) return { avgBpm: i.manualAvgHr, maxBpm: i.manualAvgHr, supportedS: 0, method: 'manual' };
  return null;
}

/**
 * The bout's estimates, the booked one and its ledger terms. Throws only for an unknown exercise id with no record given
 * (a caller bug); every data problem is a `rejected` reason or a MET fallback, never NaN.
 */
export function activityEnergy(i: ActivityEnergyInput): ActivityEnergy {
  const ex = i.exercise ?? exerciseRecordOf(i.exerciseId);
  if (!ex) throw new Error(`activityEnergy: unknown exercise ${i.exerciseId}`);
  const traits = activityTraitsOf(ex);
  const estimates: EnergyEstimate[] = [];
  const rejected: ActivityEnergy['rejected'] = [];
  const order: readonly ActivityEstimator[] = traits.estimators.includes('met') ? traits.estimators : [...traits.estimators, 'met'];
  for (const e of order) {
    let r: EnergyEstimate | string;
    switch (e) {
      case 'reported':
        r = i.reported && isFiniteNum(i.reported.grossKcal) && i.reported.grossKcal >= 0
          ? { estimator: 'reported', grossKcal: i.reported.grossKcal, method: 'reported', version: 'reported/1', envelope: { lo: i.reported.grossKcal, hi: i.reported.grossKcal }, uncertaintyKind: 'unknown', domainFlags: [], bookable: true, provenance: i.reported.provenance }
          : 'notReported';
        break;
      case 'power':
        r = powerEstimate(i);
        break;
      case 'speedGrade':
        r = speedGradeEst(ex, traits, i);
        break;
      case 'personalHr':
        r = 'noCalibration';
        break;
      case 'keytel':
        r = keytelEstimate(ex, traits, i);
        if (typeof r !== 'string' && !r.bookable) r.domainFlags.push('d2Off');
        break;
      case 'met':
        r = metEstimate(ex, i);
        break;
    }
    if (typeof r === 'string') {
      if (r !== 'notReported') rejected.push({ estimator: e, reason: r });
    } else estimates.push(r);
  }
  // power is not in a type's estimators unless it is a leg cycle ergometer: say why air-bike watts were ignored
  if (i.power && !order.includes('power')) rejected.push({ estimator: 'power', reason: 'displayWattsNotMetabolicWork' });
  const booked = estimates.find((e) => e.bookable) ?? metEstimate(ex, i);
  const comparisons = estimates.filter((e) => e !== booked);
  const cost = boutCost({
    grossKcal: booked.grossKcal,
    durationMin: i.durationMin,
    rmrKcalPerDay: i.rmrKcalPerDay,
    bodyMassKg: i.massKg,
    displacedFracOfRmr: i.displacedFracOfRmr === undefined ? DISPLACED_BASELINE : i.displacedFracOfRmr,
    method: booked.method,
    domain: booked.version,
    source: 'estimated',
  });
  cost.uncertaintyKind = booked.uncertaintyKind;
  cost.envelope = booked.envelope;
  cost.estimatorVersion = booked.version;
  cost.inputsRef = i.inputsRef ?? contentHash({ ...i, exercise: undefined, hr: i.hr ? { n: i.hr.segments.length, window: i.hr.window } : undefined });
  return {
    version: SENSOR_VERSIONS.activityEnergy,
    exerciseId: ex.id,
    traits,
    booked,
    comparisons,
    rejected,
    vendor: (i.vendor ?? []).filter((v) => isFiniteNum(v.kcal)).map((v) => ({ ...v, label: 'comparison, never booked' as const })),
    cost,
    engineDose: realisedEngineDose({ grossKcal: booked.grossKcal, durationMin: i.durationMin, massKg: i.massKg }),
    hrSummary: hrSummaryOf(i),
    status: 'inferred',
  };
}
