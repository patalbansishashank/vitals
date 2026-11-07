/**
 * A planned (future) bout's energy and points (`project-activity/1`, energy SPEC §V2.9, RESEARCH III.E).
 *
 * Inputs are the future dose only (type, minutes, speed/grade/power, class): there is no future HR, so Keytel and
 * personal HR never apply and a zone distribution is `null` (it needs a calibrated modality-specific HR relation, deferred).
 * The estimate is the same `activityEnergy` chain without HR (speed/grade or power when given and in domain, else the
 * matched MET), so a planned and a realised bout of the same dose cost the same.
 *
 * Output: G, R, A, D, I (shared ledger, §1.3), the scenario envelope, the method, a Heart Points range from the class (the
 * MET channel of `fit-points/1` over the MET envelope, or the class's points when stated), `stepsIncluded` only for gait
 * with a calibrated step length (no default step length is assumed), `zoneDistribution: null`.
 *
 * Warrants: causally coherent A (only future-available inputs); analytically true A (energy semantics); ecologically valid
 * B (history transfer fails for a new modality or changed fitness). Peak HR, time in zone and next-day HRV are unknown.
 */
import { activityEnergy, exerciseRecordOf, intensityClassOf, type ActivityEnergyInput } from './activityEnergy';
import { SENSOR_VERSIONS, isFiniteNum, sp, type Envelope, type IntensityClass } from './types';

export interface ProjectActivityInput {
  exerciseId: string;
  durationMin: number;
  massKg: number;
  rmrKcalPerDay: number | null;
  speedKmh?: number | null;
  gradeFrac?: number | null;
  /** Belt (treadmill) or ground speed. */
  speedSource?: 'belt' | 'gps';
  powerW?: number | null;
  powerVerified?: boolean;
  intensityClass?: IntensityClass;
  /** A calibrated step length (m) for gait: enables `stepsIncluded`. */
  stepLengthM?: number | null;
  displacedFracOfRmr?: number | null;
}

export interface ProjectedActivity {
  version: typeof SENSOR_VERSIONS.projectActivity;
  G: number;
  R: number;
  A: number;
  D: number | null;
  I: number | null;
  envelope: Envelope;
  uncertaintyKind: 'scenario';
  method: string;
  estimatorVersion: string;
  pointsRange: { lo: number; hi: number };
  stepsIncluded: number | null;
  zoneDistribution: null;
  status: 'asPlanned';
}

const pointsPerMin = (met: number): number => (met >= sp('fitMetVigorous') ? 2 : met >= sp('fitMetModerate') ? 1 : 0);

export function projectActivity(i: ProjectActivityInput): ProjectedActivity {
  const input: ActivityEnergyInput = {
    exerciseId: i.exerciseId,
    durationMin: i.durationMin,
    massKg: i.massKg,
    ageY: null,
    sex: null,
    rmrKcalPerDay: i.rmrKcalPerDay,
    ...(i.displacedFracOfRmr !== undefined ? { displacedFracOfRmr: i.displacedFracOfRmr } : {}),
    d2Keytel: false,
    ...(isFiniteNum(i.speedKmh) ? { speed: { kmh: i.speedKmh, gradeFrac: i.gradeFrac ?? null, source: i.speedSource ?? 'gps' } } : {}),
    ...(isFiniteNum(i.powerW) ? { power: { avgW: i.powerW, verified: i.powerVerified === true } } : {}),
    ...(i.intensityClass ? { intensity: { class: i.intensityClass } } : {}),
  };
  const e = activityEnergy(input);
  const ex = exerciseRecordOf(i.exerciseId)!;
  const minutes = i.durationMin;
  const cls = intensityClassOf(input.intensity);
  let lo: number;
  let hi: number;
  if (cls === 'moderate' || cls === 'vigorous' || cls === 'light') {
    const r = cls === 'vigorous' ? 2 : cls === 'moderate' ? 1 : 0;
    lo = hi = r * minutes;
  } else {
    // the equivalent MET of the booked gross and its envelope, through the MET channel
    const perMin = (g: number) => (g * 1000) / (3.5 * 5 * i.massKg * minutes);
    const metLo = minutes > 0 ? perMin(e.booked.envelope.lo) : 0;
    const metHi = minutes > 0 ? perMin(e.booked.envelope.hi) : 0;
    lo = pointsPerMin(metLo) * minutes;
    hi = pointsPerMin(metHi) * minutes;
  }
  const gait = ex.cardioModality === 'walk' || ex.cardioModality === 'run';
  const stepsIncluded = gait && isFiniteNum(i.stepLengthM) && i.stepLengthM > 0 && isFiniteNum(i.speedKmh) ? Math.round((i.speedKmh * 1000 * (minutes / 60)) / i.stepLengthM) : null;
  return {
    version: SENSOR_VERSIONS.projectActivity,
    G: e.cost.grossKcal,
    R: e.cost.ownRestKcal,
    A: e.cost.netAboveRestKcal,
    D: e.cost.displacedLifestyleKcal,
    I: e.cost.incrementalKcal,
    envelope: e.booked.envelope,
    uncertaintyKind: 'scenario',
    method: e.booked.method,
    estimatorVersion: e.booked.version,
    pointsRange: { lo, hi },
    stepsIncluded,
    zoneDistribution: null,
    status: 'asPlanned',
  };
}
