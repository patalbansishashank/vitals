/**
 * Stimulus mapping (PLAN item 11; R3 §3-4; PLANNER_V2 §8.3/§8.6): every exercise, listed or not, resolves to the engine's
 * own training-dose terms. No new physiology: effective sets per region use the muscle module's e_set factors
 * (f_RIR, f_load, f_rest; read from its registry), cardio uses the activity module's MET/MEM conventions, and the
 * catalogue only adds the set-type factor (ballistic 0.5, isometric 0.5 unless near failure; R3 §3.1) and the
 * hybrid split (R3 §3.3).
 *
 * Two outputs per performed exercise:
 * - `setsByRegion` = counted sets × region weight × set-type factor: the engine input (`ResistanceSession.setsByRegion`);
 *   the engine applies f_RIR, f_load and f_rest itself from the session's rir, loadPct1RM and restSec.
 * - `effectiveSetsByRegion` = the same with f_RIR·f_load·f_rest applied per set: the stimulus currency for equivalence.
 */
import type { CardioSession, ResistanceSession, RtVolumePreset } from '@/engine/types/schedule';
import { DEFAULTS, RT_PRESETS, RT_STYLE_MET } from '@/engine/core/defaults';
import { cp, ENGINE } from './params';
import { exerciseTau } from './evidence';
import { RESISTANCE_PATTERNS } from './vocab';
import type {
  CardioModality,
  Catalogue,
  EnergyEquation,
  EvidenceGrade,
  ExerciseRecord,
  ImplementClass,
  LoadClass,
  MovementPattern,
  PerformedExercise,
  PerformedSet,
  StimulusVector,
  StrengthWork,
  TrainingRegion,
} from './types';

// ================================================================== context and results

/** Person-level inputs every energy and intensity term needs. */
export interface StimulusContext {
  bodyMassKg: number;
  /** VO2max, mL/kg/min (engine state or estimate). */
  vo2max: number;
  heightM?: number;
  /** Resting metabolic rate, kcal/d (cycling-by-watts equation); default 1 MET when absent. */
  rmrKcalPerDay?: number;
}

export interface EnergyEstimate {
  /** Gross kcal of the bout. */
  grossKcal: number;
  /** Net kcal above own rest, (MET − 1)·3.5·kg/200 per minute. */
  netKcal: number;
  /** P10–P90-style band of the net kcal (MET range, or the equation's certainty floor). */
  netLow: number;
  netHigh: number;
  /** Equation actually used (falls back to `met` when its inputs are missing). */
  method: EnergyEquation;
  /** Effective gross MET of the bout. */
  met: number;
}

export interface CardioPart {
  modality: CardioModality;
  minutes: number;
  /** Gross MET (session average). */
  met: number;
  /** Fraction of VO2max, x = MET·3.5/VO2max. */
  x: number;
  /** Moderate-equivalent minutes (engine memWeight(x) × minutes). */
  mem: number;
  /** Minutes at x ≥ hardX. */
  hiMinutes: number;
}

/** One performed (or prescribed) exercise resolved to engine terms. */
export interface ExerciseDose {
  exerciseId: string;
  pattern: MovementPattern;
  implement: ImplementClass;
  /** Counted hard sets (incl. ballistic bouts that qualify). */
  sets: number;
  /** Σ set-type factors (ballistic 0.5, isometric 0.5/1, else 1). */
  creditedSets: number;
  meanReps: number | null;
  meanRir: number;
  /** Set-weighted %1RM (or %1RM-equivalent). */
  meanLoadPct: number;
  restSec: number;
  minutes: number;
  resistanceMinutes: number;
  cardioMinutes: number;
  /** Engine input: counted sets × region weight × set-type factor. */
  setsByRegion: Partial<Record<TrainingRegion, number>>;
  /** E_r: with f_RIR·f_load·f_rest per set. */
  effectiveSetsByRegion: Partial<Record<TrainingRegion, number>>;
  /** E_r one more set at the same dose would add. */
  perSetCredit: Partial<Record<TrainingRegion, number>>;
  cardio: CardioPart | null;
  mobilityMinutes: Record<string, number>;
  energy: EnergyEstimate;
  /** σ of ln τ for mapped items (R5), 0 for modelled ones. */
  tauSd: number;
  /** Region roles of the item (1 direct, 0.5 indirect): the default plan priority π_r when this is a prescription. */
  regionRoles: Partial<Record<TrainingRegion, number>>;
}

// ================================================================== engine factor functions (muscle 09 §4.1 / §4.14)

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** k_RIR(L): heavy ≥ 80 %, light < 60 %, else the moderate slope. */
export function kRirFor(loadPct: number): number {
  if (loadPct >= ENGINE.loadHeavyPct) return ENGINE.kRirHeavy;
  if (loadPct < ENGINE.loadModeratePct) return ENGINE.kRirLight;
  return ENGINE.kRir;
}
export const fRir = (rir: number, loadPct: number): number => clamp(1 - kRirFor(loadPct) * Math.max(0, rir), 0, 1);
export function fLoad(loadPct: number): number {
  if (loadPct >= ENGINE.loadFullPct) return 1;
  if (loadPct >= ENGINE.loadVeryLightPct)
    return ENGINE.fLoad20 + ((1 - ENGINE.fLoad20) * (loadPct - ENGINE.loadVeryLightPct)) / (ENGINE.loadFullPct - ENGINE.loadVeryLightPct);
  return ENGINE.fLoadVeryLight;
}
export function fRest(restSec: number): number {
  if (restSec <= ENGINE.restShortSec) return ENGINE.fRest60;
  if (restSec < ENGINE.restFullSec) return ENGINE.fRest90;
  return 1;
}
/** Strength load factor f_loadS: 1.0 ≥ 80 %, 0.85 at 60–80 %, 0.65 below. */
export function fLoadStrength(loadPct: number): number {
  if (loadPct >= ENGINE.loadHeavyPct) return 1;
  if (loadPct >= ENGINE.loadModeratePct) return ENGINE.fLoadSMod;
  return ENGINE.fLoadSLight;
}
export function loadClassOf(loadPct: number): LoadClass {
  if (loadPct >= ENGINE.loadHeavyPct) return 'heavy';
  if (loadPct >= ENGINE.loadModeratePct) return 'moderate';
  if (loadPct >= ENGINE.loadFullPct) return 'light';
  return 'veryLight';
}
/** Activity 10 §4.8B moderate-equivalent weight per minute at x. */
export function memWeight(x: number): number {
  return x < ENGINE.memBand1 ? 0 : x < ENGINE.memBand2 ? ENGINE.memW1 : x < ENGINE.memBand3 ? ENGINE.memW2 : ENGINE.memW3;
}

// ================================================================== load from reps (R3 §3.2)

/** L_eq = 100 / (1 + R_f/30): %1RM-equivalent of a set whose reps to failure are R_f (Epley inverse). */
export function loadPctFromRepsToFailure(repsToFailure: number): number {
  return 100 / (1 + Math.max(1, repsToFailure) / cp('epleyDivisor'));
}
/** Reps to failure at a %1RM (inverse of `loadPctFromRepsToFailure`). */
export function repsToFailureAt(loadPct: number): number {
  return cp('epleyDivisor') * (100 / clamp(loadPct, 1, 100) - 1);
}

// ================================================================== implement class

const IMPLEMENT: Readonly<Record<string, ImplementClass>> = {
  barbell: 'bar', plates: 'bar', sumtola: 'bar', nal: 'bar', wheel_or_rod: 'bar',
  dumbbell: 'handheld', kettlebell: 'handheld', water_jug: 'handheld', bucket: 'handheld', medicine_ball: 'handheld',
  leg_press: 'machine', leg_machine: 'machine', cable_station: 'machine', stair_climber: 'machine',
  band_mini: 'band', band_tube: 'band', band_loop_long: 'band',
  mudgar_heavy: 'club', mudgar_pair: 'club', indian_clubs: 'club', gada: 'club', steel_mace: 'club', sledgehammer: 'club', shovel: 'club',
  sandbag: 'odd', backpack: 'odd', tyre: 'odd', gar_nal: 'odd', weighted_vest: 'odd', battle_rope: 'odd',
  pullup_bar: 'bodyweight', dip_bars: 'bodyweight', rings: 'bodyweight', suspension_trainer: 'bodyweight', outdoor_bars: 'bodyweight',
  climbing_rope: 'bodyweight', mallakhamb_pole: 'bodyweight', rope_mallakhamb: 'bodyweight',
};

/** Implement geometry of an exercise as done with `equipment` (default: its first equipment alternative). */
export function implementOf(ex: ExerciseRecord, equipment?: readonly string[]): ImplementClass {
  const eq = equipment ?? ex.equipmentAnyOf[0] ?? [];
  for (const id of eq) {
    const c = IMPLEMENT[id];
    if (c) return c;
  }
  if (ex.loadType === 'cardio' || ex.loadType === 'mobility') return 'none';
  return 'bodyweight';
}

// ================================================================== sets

interface SetSpec {
  /** Fraction of a set (1, or the remainder of a time-derived set count). */
  weight: number;
  reps: number | null;
  holdSec: number | null;
  workSec: number | null;
  loadPct: number;
  rir: number;
  /** Set-type factor (0 when the set is not a hard set: cardio, mobility, short ballistic bouts). */
  factor: number;
  /** An isometric hold (f_RIR and f_load do not apply; the near-failure rule does). */
  hold: boolean;
  counted: boolean;
}

function rirOf(s: PerformedSet | undefined, perf: PerformedExercise, ex: ExerciseRecord): number {
  const rir = s?.rir ?? perf.rir;
  if (rir !== undefined) return Math.max(0, rir);
  const rpe = s?.rpe ?? perf.rpe;
  if (rpe !== undefined) return clamp(10 - rpe, 0, 10);
  if (ex.defaultDose.rir !== undefined) return ex.defaultDose.rir;
  return ex.loadType === 'ballistic' ? cp('ballisticDefaultRir') : cp('defaultRir');
}

const HARD_SET_LOADS: ReadonlySet<ExerciseRecord['loadType']> = new Set(['external', 'bodyweight', 'odd-object', 'isometric', 'ballistic']);

/** Default-dose minutes of an item (its own time formula with no log). */
function defaultMinutes(ex: ExerciseRecord): number {
  const dd = ex.defaultDose;
  if (dd.durationMin !== undefined) return dd.durationMin;
  const n = dd.sets ?? dd.rounds ?? 0;
  if (dd.secPerRound !== undefined) return (n * dd.secPerRound) / 60;
  const work = dd.reps !== undefined ? dd.reps * ex.secPerRep : (dd.holdSec ?? dd.workSec ?? dd.durationSec ?? 0);
  return (n * (work + (dd.restSec ?? 0))) / 60;
}

/**
 * Number of sets of a log: explicit sets, else the logged count, else (when only minutes are logged) the default count
 * scaled by minutes / default minutes, else the default count. Minute-only resistance items (flows, circuits,
 * mallakhamb) count one set per 2.5 resistance minutes (engine default, 09 §4.13).
 */
function setCountOf(ex: ExerciseRecord, perf: PerformedExercise): number {
  const dd = ex.defaultDose;
  const resistShare = 1 - Math.min(1, Math.max(0, ex.hybridCardioShare));
  // flows logged in rounds of a fixed length (Surya Namaskar): hard sets from resistance time, like minute-only items
  if (dd.secPerRound !== undefined) {
    if (!HARD_SET_LOADS.has(ex.loadType)) return 0;
    return (resistShare * flowMinutes(ex, perf)) / DEFAULTS.rtMinPerSet;
  }
  const explicit = perf.setCount ?? perf.rounds;
  if (explicit !== undefined) return Math.max(0, explicit);
  const ddCount = dd.sets ?? dd.rounds;
  if (ddCount !== undefined) {
    const m0 = defaultMinutes(ex);
    return perf.minutes !== undefined && m0 > 0 ? (ddCount * perf.minutes) / m0 : ddCount;
  }
  if (HARD_SET_LOADS.has(ex.loadType)) return (resistShare * (perf.minutes ?? dd.durationMin ?? 0)) / DEFAULTS.rtMinPerSet;
  return 0;
}

/** Minutes of a round-based flow: logged minutes, else rounds × seconds per round. */
function flowMinutes(ex: ExerciseRecord, perf: PerformedExercise): number {
  if (perf.minutes !== undefined) return Math.max(0, perf.minutes);
  const rounds = perf.rounds ?? perf.setCount ?? ex.defaultDose.rounds ?? 0;
  return (rounds * (ex.defaultDose.secPerRound ?? 0)) / 60;
}

function expandSets(ex: ExerciseRecord, perf: PerformedExercise): SetSpec[] {
  const dd = ex.defaultDose;
  const proto: PerformedSet[] = [];
  const weights: number[] = [];
  if (perf.sets && perf.sets.length > 0) {
    proto.push(...perf.sets);
    for (let i = 0; i < perf.sets.length; i++) weights.push(1);
  } else {
    const n = setCountOf(ex, perf);
    const whole = Math.floor(n + 1e-9);
    for (let i = 0; i < whole; i++) {
      proto.push({});
      weights.push(1);
    }
    const rem = n - whole;
    if (rem > 1e-6) {
      proto.push({});
      weights.push(rem);
    }
  }
  const oneRm = perf.oneRepMaxKg;
  const out: SetSpec[] = [];
  for (let k = 0; k < proto.length; k++) {
    const s = proto[k]!;
    const weight = weights[k]!;
    const reps = s.reps ?? perf.reps ?? dd.reps ?? null;
    const holdSec = s.holdSec ?? perf.holdSec ?? dd.holdSec ?? null;
    const workSec = s.workSec ?? perf.workSec ?? dd.workSec ?? dd.durationSec ?? null;
    const rir = rirOf(s, perf, ex);
    let loadPct: number;
    const pct = s.pct1RM ?? perf.pct1RM;
    const kg = s.loadKg ?? perf.loadKg;
    if (pct !== undefined) loadPct = pct;
    else if (kg !== undefined && oneRm !== undefined && oneRm > 0) loadPct = (100 * kg) / oneRm;
    else if (reps !== null && ex.loadType !== 'isometric') loadPct = loadPctFromRepsToFailure(reps + rir);
    else if (holdSec !== null && reps === null) loadPct = ENGINE.loadFullPct; // a hold: load-independent above 35 %1RM
    else loadPct = cp('ballisticDefaultLoadPct');
    loadPct = clamp(loadPct, 1, 100);

    let factor: number;
    let counted = true;
    const hold = ex.loadType === 'isometric' || (holdSec !== null && reps === null);
    switch (hold && ex.loadType !== 'mobility' && ex.loadType !== 'cardio' ? 'isometric' : ex.loadType) {
      case 'cardio':
      case 'mobility':
        factor = 0;
        counted = false;
        break;
      case 'ballistic': {
        const rpe = s.rpe ?? perf.rpe;
        const qualifies = (reps !== null && reps > 0) || (workSec !== null && workSec >= cp('ballisticMinWorkSec'));
        counted = qualifies && (rpe === undefined || rpe >= 7);
        factor = counted ? (ex.loadFactor?.mode ?? cp('ballisticSetFactor')) : 0;
        break;
      }
      case 'isometric':
        factor = s.nearFailure ? 1 : cp('isometricNonFailureFactor');
        break;
      default:
        factor = 1;
    }
    // a hold's proximity to failure is carried by its factor; RIR 0 keeps the engine's f_RIR from discounting it again
    out.push({ weight, reps, holdSec, workSec, loadPct, rir: hold ? 0 : rir, factor, counted, hold });
  }
  return out;
}

function workSecOfSet(ex: ExerciseRecord, s: SetSpec): number {
  if (s.holdSec !== null && (ex.volumeUnit === 'holds' || s.reps === null)) return s.holdSec;
  if (s.workSec !== null && s.reps === null) return s.workSec;
  if (s.reps !== null) return s.reps * ex.secPerRep;
  return s.workSec ?? s.holdSec ?? 0;
}

/** Minutes of a bout: logged minutes, else sets × (work + rest), else the default dose's time (R3 §2.1, PLANNER_V2 §8.3). */
function boutMinutes(ex: ExerciseRecord, perf: PerformedExercise, sets: SetSpec[], restSec: number): number {
  if (perf.minutes !== undefined) return Math.max(0, perf.minutes);
  const dd = ex.defaultDose;
  if (dd.secPerRound !== undefined && !perf.sets) return flowMinutes(ex, perf);
  if (dd.durationMin !== undefined && dd.sets === undefined && dd.rounds === undefined && perf.setCount === undefined && perf.rounds === undefined && !perf.sets) return dd.durationMin;
  if (sets.length > 0) {
    let sec = 0;
    for (const s of sets) sec += s.weight * (workSecOfSet(ex, s) + restSec);
    return sec / 60;
  }
  return dd.durationMin ?? 0;
}

// ================================================================== energy (R3 §4)

const EQUATION_GRADE: Readonly<Record<EnergyEquation, EvidenceGrade>> = {
  met: 'A', ludlowWalk: 'A', acsmWalk: 'A', acsmRun: 'B', acsmStep: 'B', cyclePower: 'B', pandolf: 'B',
};
const BAND_FLOOR: Readonly<Record<EvidenceGrade, string>> = { A: 'bandFloorA', B: 'bandFloorB', C: 'bandFloorC', D: 'bandFloorD' };

/** kcal/min per MET for a person (1 MET = 3.5 mL/kg/min × kcal per L O2). */
const kcalPerMinPerMet = (kg: number): number => (ENGINE.metVo2 * kg * ENGINE.kcalPerLO2) / 1000;

/**
 * Gross MET of a bout from the item's equation when its inputs are present (R3 §4), else null.
 * VO2 in mL/kg/min; MET = VO2/3.5.
 */
function equationMet(ex: ExerciseRecord, perf: PerformedExercise, ctx: StimulusContext): number | null {
  const v = perf.speedKmh;
  const sMin = v !== undefined ? (v * 1000) / 60 : undefined; // m/min
  const g = (perf.gradePct ?? 0) / 100;
  const rest = ENGINE.metVo2;
  switch (ex.energy.equation) {
    case 'ludlowWalk':
    case 'acsmWalk': {
      if (v === undefined || sMin === undefined) return null;
      const vMs = v / 3.6;
      const horiz = ctx.heightM ? ENGINE.walkIntercept + (ENGINE.walkSlope * vMs * vMs) / ctx.heightM : 0.1 * sMin;
      const vert = ex.energy.equation === 'acsmWalk' ? 1.8 * sMin * g : 0;
      return (rest + horiz + vert) / ENGINE.metVo2;
    }
    case 'acsmRun': {
      if (sMin === undefined) return null;
      return (rest + ENGINE.runEff * ENGINE.runVo2PerM * sMin + 0.9 * sMin * g) / ENGINE.metVo2;
    }
    case 'acsmStep': {
      const f = perf.stepRatePerMin;
      if (f === undefined) return null;
      const h = perf.stepHeightM ?? cp('stairStepHeightM');
      return (0.2 * f + 1.33 * 1.8 * h * f + rest) / ENGINE.metVo2;
    }
    case 'cyclePower': {
      if (perf.powerW === undefined) return null;
      const rmrPerMin = ctx.rmrKcalPerDay !== undefined ? ctx.rmrKcalPerDay / 1440 : kcalPerMinPerMet(ctx.bodyMassKg);
      const gross = ENGINE.cycleBaselineMult * rmrPerMin + (perf.powerW * 60) / (ENGINE.cycleEff * 4184);
      return gross / kcalPerMinPerMet(ctx.bodyMassKg);
    }
    case 'pandolf': {
      if (v === undefined) return null;
      const W = ctx.bodyMassKg;
      const L = perf.loadCarriedKg ?? 0;
      const V = v / 3.6;
      const eta =
        perf.terrain === 'dirt' ? cp('pandolfEtaDirt') : perf.terrain === 'lightBrush' ? cp('pandolfEtaLightBrush') : perf.terrain === 'heavyBrush' ? cp('pandolfEtaHeavyBrush') : cp('pandolfEtaRoad');
      const watts = 1.5 * W + 2.0 * (W + L) * (L / W) ** 2 + eta * (W + L) * (1.5 * V * V + 0.35 * V * (perf.gradePct ?? 0));
      return (watts * 60) / 4184 / kcalPerMinPerMet(W);
    }
    default:
      return null;
  }
}

function cardioMetFromRpe(rpe: number, ctx: StimulusContext): number {
  const x = clamp(ENGINE.rpeIntercept + ENGINE.rpeSlope * rpe, 0.2, 1.2);
  return (x * ctx.vo2max) / ENGINE.metVo2;
}

/** Energy of a bout of `minutes` (R3 §4); band from the MET range or the equation's certainty floor (R5 §2.3). */
export function boutEnergy(ex: ExerciseRecord, perf: PerformedExercise, minutes: number, ctx: StimulusContext): EnergyEstimate {
  const perMet = kcalPerMinPerMet(ctx.bodyMassKg);
  let met = ex.energy.metGross;
  let method: EnergyEquation = 'met';
  let lo = ex.energy.metRange[0];
  let hi = ex.energy.metRange[1];
  const eq = equationMet(ex, perf, ctx);
  if (perf.met !== undefined && perf.met > 0) {
    met = perf.met;
    lo = Math.min(lo, met);
    hi = Math.max(hi, met);
  } else if (eq !== null) {
    met = eq;
    method = ex.energy.equation;
    const z = 1.2816 * cp(BAND_FLOOR[EQUATION_GRADE[method]]!);
    lo = 1 + (met - 1) * (1 - z);
    hi = 1 + (met - 1) * (1 + z);
  } else if (perf.rpe !== undefined && (ex.loadType === 'cardio' || ex.hybridCardioShare >= 1)) {
    met = cardioMetFromRpe(perf.rpe, ctx);
    lo = Math.min(lo, met);
    hi = Math.max(hi, met);
  }
  const net = (m: number): number => Math.max(0, m - 1) * perMet * minutes;
  return { grossKcal: met * perMet * minutes, netKcal: net(met), netLow: net(Math.min(lo, met)), netHigh: net(Math.max(hi, met)), method, met };
}

// ================================================================== resolve one exercise

const add = (o: Partial<Record<TrainingRegion, number>>, r: TrainingRegion, v: number): void => {
  if (v !== 0) o[r] = (o[r] ?? 0) + v;
};

/** Resolve a performed (or prescribed) instance of a catalogue exercise to engine terms (R3 §3). */
export function resolveDose(ex: ExerciseRecord, perf: PerformedExercise, ctx: StimulusContext): ExerciseDose {
  const sets = expandSets(ex, perf);
  const restSec = perf.restSec ?? ex.defaultDose.restSec ?? 0;
  const fr = fRest(restSec);
  const minutes = boutMinutes(ex, perf, sets, restSec);
  const h = clamp(ex.hybridCardioShare, 0, 1);
  const cardioMinutes = h * minutes;
  const resistanceMinutes = minutes - cardioMinutes;

  const setsByRegion: Partial<Record<TrainingRegion, number>> = {};
  const eff: Partial<Record<TrainingRegion, number>> = {};
  let counted = 0;
  let credited = 0;
  let sumRir = 0;
  let sumLoad = 0;
  let sumReps = 0;
  let nReps = 0;
  let last: SetSpec | null = null;
  for (const s of sets) {
    if (!s.counted || s.factor === 0) continue;
    counted += s.weight;
    credited += s.factor * s.weight;
    sumRir += s.rir * s.weight;
    sumLoad += s.loadPct * s.weight;
    if (s.reps !== null) {
      sumReps += s.reps * s.weight;
      nReps += s.weight;
    }
    const e = s.factor * s.weight * (s.hold ? 1 : fRir(s.rir, s.loadPct) * fLoad(s.loadPct)) * fr;
    for (const [r, w] of Object.entries(ex.regions) as Array<[TrainingRegion, number]>) {
      add(setsByRegion, r, w * s.factor * s.weight);
      add(eff, r, w * e);
    }
    last = s;
  }
  const perSetCredit: Partial<Record<TrainingRegion, number>> = {};
  const proto = last ?? expandSets(ex, { ...perf, sets: undefined, setCount: 1, rounds: undefined })[0];
  if (proto && proto.factor > 0) {
    const e = proto.factor * (proto.hold ? 1 : fRir(proto.rir, proto.loadPct) * fLoad(proto.loadPct)) * fr;
    for (const [r, w] of Object.entries(ex.regions) as Array<[TrainingRegion, number]>) add(perSetCredit, r, w * e);
  }

  const energy = boutEnergy(ex, perf, minutes, ctx);
  let cardio: CardioPart | null = null;
  if (cardioMinutes > 0) {
    const x = (energy.met * ENGINE.metVo2) / ctx.vo2max;
    cardio = {
      modality: ex.cardioModality ?? 'other',
      minutes: cardioMinutes,
      met: energy.met,
      x,
      mem: memWeight(x) * cardioMinutes,
      hiMinutes: x >= ENGINE.hardX ? cardioMinutes : 0,
    };
  }

  const mobilityMinutes: Record<string, number> = {};
  if (ex.mobilityTargets.length > 0) {
    // active time under stretch: the work part of each set (holds, reps), or the whole bout for flows
    let active = 0;
    if (sets.length > 0 && perf.minutes === undefined && ex.defaultDose.durationMin === undefined && ex.defaultDose.secPerRound === undefined)
      for (const s of sets) active += (s.weight * workSecOfSet(ex, s)) / 60;
    else active = minutes;
    if (ex.loadType !== 'mobility' && ex.loadType !== 'isometric') active = Math.min(active, minutes);
    const share = active / ex.mobilityTargets.length;
    for (const t of ex.mobilityTargets) mobilityMinutes[t] = (mobilityMinutes[t] ?? 0) + share;
  }

  return {
    exerciseId: ex.id,
    pattern: ex.pattern,
    implement: implementOf(ex, perf.equipmentUsed),
    sets: counted,
    creditedSets: credited,
    meanReps: nReps > 0 ? sumReps / nReps : null,
    meanRir: counted > 0 ? sumRir / counted : (ex.defaultDose.rir ?? cp('defaultRir')),
    meanLoadPct: counted > 0 ? sumLoad / counted : cp('ballisticDefaultLoadPct'),
    restSec,
    minutes,
    resistanceMinutes,
    cardioMinutes,
    setsByRegion,
    effectiveSetsByRegion: eff,
    perSetCredit,
    cardio,
    mobilityMinutes,
    energy,
    tauSd: ex.status === 'mapped' ? exerciseTau(ex).sigmaLog : 0,
    regionRoles: { ...ex.regions },
  };
}

// ================================================================== aggregate to the stimulus vector

/** Aggregate resolved doses into one `StimulusVector` (PLANNER_V2 §8.6, R3 §5.1). */
export function aggregateStimulus(doses: readonly ExerciseDose[]): StimulusVector {
  const eff: Partial<Record<TrainingRegion, number>> = {};
  const prio: Partial<Record<TrainingRegion, number>> = {};
  const perSet: Partial<Record<TrainingRegion, number>> = {};
  const mob: Record<string, number> = {};
  const strength: StrengthWork[] = [];
  let net = 0;
  let mem = 0;
  let hi = 0;
  let minutes = 0;
  let cardioMin = 0;
  let sets = 0;
  let sumLoad = 0;
  let sumRir = 0;
  let tau = 0;
  let domPattern: MovementPattern | null = null;
  let domWeight = -1;
  for (const d of doses) {
    for (const [r, v] of Object.entries(d.effectiveSetsByRegion) as Array<[TrainingRegion, number]>) add(eff, r, v);
    for (const [r, v] of Object.entries(d.regionRoles) as Array<[TrainingRegion, number]>) {
      if ((d.effectiveSetsByRegion[r] ?? 0) > 0) prio[r] = Math.max(prio[r] ?? 0, v);
    }
    for (const [r, v] of Object.entries(d.perSetCredit) as Array<[TrainingRegion, number]>) perSet[r] = Math.max(perSet[r] ?? 0, v);
    for (const [t, v] of Object.entries(d.mobilityMinutes)) mob[t] = (mob[t] ?? 0) + v;
    net += d.energy.netKcal;
    minutes += d.minutes;
    if (d.cardio) {
      mem += d.cardio.mem;
      hi += d.cardio.hiMinutes;
      cardioMin += d.cardio.minutes;
    }
    sets += d.sets;
    sumLoad += d.meanLoadPct * d.sets;
    sumRir += d.meanRir * d.sets;
    tau = Math.max(tau, d.tauSd);
    if (d.sets > 0 && RESISTANCE_PATTERNS.has(d.pattern)) strength.push({ pattern: d.pattern, implement: d.implement, sets: d.sets, loadPct: d.meanLoadPct });
    const w = d.creditedSets > 0 ? 1000 + d.creditedSets : d.minutes;
    if (w > domWeight) {
      domWeight = w;
      domPattern = d.pattern;
    }
  }
  const meanLoad = sets > 0 ? sumLoad / sets : 0;
  return {
    effectiveSetsByRegion: eff,
    pattern: domPattern ?? 'complex',
    loadClass: sets > 0 ? loadClassOf(meanLoad) : 'veryLight',
    netKcal: net,
    mem,
    hiMinutes: hi,
    mobilityMinutes: mob,
    tauSd: tau,
    regionPriority: prio,
    strength,
    perSetCredit: perSet,
    netKcalPerMin: minutes > 0 ? net / minutes : 0,
    memPerMin: cardioMin > 0 ? mem / cardioMin : 0,
    meanRir: sets > 0 ? sumRir / sets : undefined,
    minutes,
    exerciseIds: doses.map((d) => d.exerciseId),
  };
}

export interface ResolvedSession {
  doses: ExerciseDose[];
  vector: StimulusVector;
  /** Entries whose exercise is not in the catalogue (run `resolveUnknown` first); they add nothing. */
  unresolved: PerformedExercise[];
}

/** Resolve a logged or prescribed session against the catalogue. */
export function resolveSession(log: readonly PerformedExercise[], catalogue: Catalogue, ctx: StimulusContext): ResolvedSession {
  const doses: ExerciseDose[] = [];
  const unresolved: PerformedExercise[] = [];
  for (const p of log) {
    const ex = p.exerciseId !== undefined ? catalogue.exercise(p.exerciseId) : undefined;
    if (!ex) unresolved.push(p);
    else doses.push(resolveDose(ex, p, ctx));
  }
  return { doses, vector: aggregateStimulus(doses), unresolved };
}

/** PLANNER_V2 §9.4 `resolveStimulus(log)`: the stimulus vector of a log (unknown entries contribute nothing). */
export function resolveStimulus(log: PerformedExercise | readonly PerformedExercise[], catalogue: Catalogue, ctx: StimulusContext): StimulusVector {
  return resolveSession(Array.isArray(log) ? (log as readonly PerformedExercise[]) : [log as PerformedExercise], catalogue, ctx).vector;
}

// ================================================================== static stimulus terms per exercise

/** The static stimulus terms of a catalogue item (what it trains, independent of a dose). */
export interface StimulusTerms {
  pattern: MovementPattern;
  regions: Partial<Record<TrainingRegion, number>>;
  loadType: ExerciseRecord['loadType'];
  intensityScale: ExerciseRecord['intensityScale'];
  volumeUnit: ExerciseRecord['volumeUnit'];
  implement: ImplementClass;
  /** Load class of the default dose. */
  defaultLoadClass: LoadClass | null;
  /** Minutes of the default dose. */
  defaultMinutes: number;
  cardio: { modality: CardioModality; share: number; metGross: number; metRange: readonly [number, number] } | null;
  mobilityTargets: readonly string[];
  /** Per-set credit factor (1, or the ballistic/isometric factor). */
  setFactor: number;
}

export function stimulusTermsOf(ex: ExerciseRecord): StimulusTerms {
  const sets = expandSets(ex, {});
  const restSec = ex.defaultDose.restSec ?? 0;
  const first = sets[0];
  return {
    pattern: ex.pattern,
    regions: { ...ex.regions },
    loadType: ex.loadType,
    intensityScale: ex.intensityScale,
    volumeUnit: ex.volumeUnit,
    implement: implementOf(ex),
    defaultLoadClass: first && first.factor > 0 ? loadClassOf(first.loadPct) : null,
    defaultMinutes: boutMinutes(ex, {}, sets, restSec),
    cardio: ex.hybridCardioShare > 0 ? { modality: ex.cardioModality ?? 'other', share: ex.hybridCardioShare, metGross: ex.energy.metGross, metRange: ex.energy.metRange } : null,
    mobilityTargets: ex.mobilityTargets,
    setFactor: ex.loadType === 'ballistic' ? (ex.loadFactor?.mode ?? cp('ballisticSetFactor')) : ex.loadType === 'isometric' ? cp('isometricNonFailureFactor') : ex.loadType === 'cardio' || ex.loadType === 'mobility' ? 0 : 1,
  };
}

// ================================================================== to engine schedule sessions (R3 §3.3)

export interface EngineTrainingDose {
  /** The resistance part (setsByRegion = counted fractionated sets; the engine applies f_RIR, f_load, f_rest). */
  resistance: ResistanceSession | null;
  /**
   * Time-weighted gross MET of the resistance part. Also written as `resistance.met` (the engine's additive
   * `ResistanceSession.met`, which overrides the `style` MET for the energy cost); `style` stays the nearest Compendium
   * style for readers that do not know `met`.
   */
  resistanceMet: number | null;
  /**
   * Cardio parts, one per modality, booked at the time-weighted gross MET. Minutes without hard sets (stretching,
   * mobility flows) are booked here as 'other' at their own MET, so their energy is exact and they add no RT dose.
   */
  cardio: CardioSession[];
  /** Energy of the whole session (no double count: hybrids book MET × total minutes once). */
  energy: { grossKcal: number; netKcal: number; netLow: number; netHigh: number };
}

const STYLES = Object.entries(RT_STYLE_MET) as Array<[NonNullable<ResistanceSession['style']>, number]>;
function nearestStyle(met: number): NonNullable<ResistanceSession['style']> {
  let best = STYLES[0]!;
  for (const s of STYLES) if (Math.abs(s[1] - met) < Math.abs(best[1] - met)) best = s;
  return best[0];
}

/** Compile resolved doses into engine schedule sessions starting at `startH` (resistance first, then cardio parts). */
export function toEngineDose(doses: readonly ExerciseDose[], startH: number): EngineTrainingDose {
  const setsByRegion: Partial<Record<TrainingRegion, number>> = {};
  let rMin = 0;
  let rMetMin = 0;
  let sets = 0;
  let sRir = 0;
  let sLoad = 0;
  let sRest = 0;
  const cardioBy = new Map<CardioModality, { minutes: number; metMin: number }>();
  let gross = 0;
  let net = 0;
  let lo = 0;
  let hi = 0;
  for (const d of doses) {
    gross += d.energy.grossKcal;
    net += d.energy.netKcal;
    lo += d.energy.netLow;
    hi += d.energy.netHigh;
    for (const [r, v] of Object.entries(d.setsByRegion) as Array<[TrainingRegion, number]>) add(setsByRegion, r, v);
    if (d.sets === 0 && d.resistanceMinutes > 0) {
      // no hard sets (stretching, mobility flows): energy only, booked as light 'other' activity at the item's own MET
      const c = cardioBy.get('other') ?? { minutes: 0, metMin: 0 };
      c.minutes += d.resistanceMinutes;
      c.metMin += d.resistanceMinutes * d.energy.met;
      cardioBy.set('other', c);
    } else if (d.resistanceMinutes > 0 || d.sets > 0) {
      rMin += d.resistanceMinutes;
      rMetMin += d.resistanceMinutes * d.energy.met;
      sets += d.sets;
      sRir += d.meanRir * d.sets;
      sLoad += d.meanLoadPct * d.sets;
      sRest += d.restSec * d.sets;
    }
    if (d.cardio) {
      const c = cardioBy.get(d.cardio.modality) ?? { minutes: 0, metMin: 0 };
      c.minutes += d.cardio.minutes;
      c.metMin += d.cardio.minutes * d.cardio.met;
      cardioBy.set(d.cardio.modality, c);
    }
  }
  const hasSets = Object.values(setsByRegion).some((v) => (v ?? 0) > 0);
  let resistance: ResistanceSession | null = null;
  let resistanceMet: number | null = null;
  if (hasSets || rMin > 0) {
    resistanceMet = rMin > 0 ? rMetMin / rMin : null;
    resistance = {
      kind: 'resistance',
      startH,
      durationMin: rMin,
      setsByRegion,
      rir: sets > 0 ? sRir / sets : cp('defaultRir'),
      loadPct1RM: sets > 0 ? sLoad / sets : cp('ballisticDefaultLoadPct'),
      restSec: sets > 0 ? sRest / sets : 0,
      style: nearestStyle(resistanceMet ?? RT_STYLE_MET.general),
      ...(resistanceMet !== null && resistanceMet > 0 ? { met: resistanceMet } : {}),
    };
  }
  const cardio: CardioSession[] = [];
  let t = startH + rMin / 60;
  for (const [modality, c] of [...cardioBy.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (c.minutes <= 0) continue;
    cardio.push({ kind: 'cardio', modality, startH: t % 24, durationMin: c.minutes, met: c.metMin / c.minutes });
    t += c.minutes / 60;
  }
  return { resistance, resistanceMet, cardio, energy: { grossKcal: gross, netKcal: net, netLow: lo, netHigh: hi } };
}

// ================================================================== weekly dose vs presets and minimum effective doses (R3 §3.4)

export interface WeeklyDose {
  /** Effective sets per region per week. */
  setsByRegion: Partial<Record<TrainingRegion, number>>;
  mem: number;
  hiMinutes: number;
  netKcal: number;
  /** Largest engine RT preset (09 §4.1) whose weekly sets the mean major region reaches; null below 'minimal'. */
  preset: RtVolumePreset | null;
  /** Trained regions below the hypertrophy minimum effective dose (4 effective sets/wk). */
  belowMinimum: TrainingRegion[];
  /** ≥ 150 MEM/wk (WHO). */
  memMet: boolean;
  /** ≥ 30 min/wk at ≥ 0.85 VO2max (engine VO2max maintenance reference). */
  vo2MaintenanceMet: boolean;
}

/** Sum a week of session stimuli and compare with the engine presets and R3 §3.4 minimum effective doses. */
export function weeklyDose(week: readonly StimulusVector[]): WeeklyDose {
  const sets: Partial<Record<TrainingRegion, number>> = {};
  let mem = 0;
  let hi = 0;
  let net = 0;
  for (const v of week) {
    for (const [r, x] of Object.entries(v.effectiveSetsByRegion) as Array<[TrainingRegion, number]>) add(sets, r, x);
    mem += v.mem;
    hi += v.hiMinutes;
    net += v.netKcal;
  }
  const trained = (Object.entries(sets) as Array<[TrainingRegion, number]>).filter(([, x]) => x > 0);
  // presets are per *major* region: regions trained at least half as much as the most-trained one
  const max = trained.reduce((a, [, x]) => Math.max(a, x), 0);
  const major = trained.filter(([, x]) => x >= 0.5 * max);
  const mean = major.length > 0 ? major.reduce((a, [, x]) => a + x, 0) / major.length : 0;
  let preset: RtVolumePreset | null = null;
  for (const [name, p] of Object.entries(RT_PRESETS) as Array<[RtVolumePreset, { setsPerRegionWeek: number }]>) if (mean >= p.setsPerRegionWeek - 1e-9) preset = name;
  return {
    setsByRegion: sets,
    mem,
    hiMinutes: hi,
    netKcal: net,
    preset,
    belowMinimum: trained.filter(([, x]) => x < cp('medHypertrophySetsWk')).map(([r]) => r).sort(),
    memMet: mem >= cp('medMemWk'),
    vo2MaintenanceMet: hi >= ENGINE.vo2HiRefMinWk,
  };
}
