/**
 * Stimulus mapping (PLAN item 11; R3 §3-4; PLANNER_V2 §8.3/§8.6): every exercise, listed or not, resolves to the engine's
 * own training-dose terms. No new physiology: effective sets per region use the muscle module's e_set factors
 * (f_RIR, f_load, f_rest; read from its registry), cardio uses the activity module's MET/MEM conventions, and the
 * catalogue only adds the set-type factor (ballistic 0.5, isometric 0.5 unless near failure; R3 §3.1) and the
 * hybrid split (R3 §3.3).
 *
 * Outputs per performed exercise:
 * - `groups` (D3-01) = homogeneous set groups (consecutive counted sets with the same contraction, set-type factor, load,
 *   RIR, reps/hold and field provenance): physical sets, per-set region weights, load %1RM, RIR reps, rest s, contraction
 *   and timing. The engine input: the muscle module applies its drawn f_RIR·f_load·f_rest and f_type once per group, then
 *   sums. Region weights are raw unless the item's set-type factor differs from the engine default for its contraction
 *   (a hold to failure, an item-specific ballistic factor); then they include it and `typeFactorIncluded` says so.
 * - `setsByRegion` = counted sets × region weight × set-type factor: the legacy merged engine input, kept for readers that
 *   do not know groups (`ResistanceSession.setsByRegionIncludesTypeFactor` marks it); its session RIR/load/rest are
 *   set-weighted summaries, never the engine dose when groups are present.
 * - `effectiveSetsByRegion` = the same with f_RIR·f_load·f_rest applied per set: the stimulus currency for equivalence.
 * Raw physical sets (`sets`), effective sets and bout energy stay distinct; energy is booked once per bout.
 *
 * 2026-10-18 (D3-02, D3-03, D3-07, D3-09):
 * - Strength work carries exercise identity, task and range of motion (exact-same-task matching in equivalence).
 * - Energy: one bout ledger (`core/exerciseCost`) — gross, own rest (the person's RMR when known, else the standard 1 MET,
 *   labelled), net above rest, displaced lifestyle and incremental kcal — the same basis the engine books. Interval bouts
 *   are integrated phase by phase (energy, MEM and high-intensity minutes), never at the work intensity throughout.
 *   A cardio bout known only by a generic CR-10 rating gets a broad scenario band, never a precise %VO2max.
 * - Public-health guideline minutes (moderate / vigorous of a stated, talk-test or relative-exertion class) are separate
 *   from the fitness MEM index; an unknown class stays unknown (null), never zero activity.

2026-10-19 (re-audit A1-021, A1-022, A1-062):
 * - Scale identity (A1-062): ratings keep their declared scale — `rirRpe`, Borg `cr10` (the serialized name of existing
 *   records), the WHO/CDC generic `relativeEffort0To10`, or unknown. Only a stated class, a talk test or a rating on the
 *   generic scale classifies guideline minutes; a CR10, RIR-RPE or unscaled number alone leaves them unknown (no CR10 →
 *   guideline conversion). The interim CR-10 → %VO2max energy scenario takes CR10 and unscaled legacy ratings only. A phase
 *   inherits only an explicitly declared bout scale.
 * - Bout timeline (A1-021): an engine cardio part is the ordered concatenation of every contributing dose's segments —
 *   interval phases, steady (non-interval) doses and the unknown-class remainder of a longer bout, each with its own MET,
 *   class and rating — so merging records never averages away work periods (thresholded MEM/hard minutes and EPOC stay
 *   those of the timeline). A whole-bout class is set only when every minute has it; known moderate/vigorous minutes are kept
 *   beside unknown ones.
 * - Unknown hard-set dose (A1-022): a minutes-only record's sets are the named `legacyMinuteConversion` scenario
 *   (`unknownDoseScenario`), carried on the dose, its groups and the engine session — never a reported count.
 * - Field provenance (D3-09): RPE becomes RIR only on the resistance RIR-RPE scale (a generic or unspecified RPE never does);
 *   the reps → %1RM inversion is used only inside its domain (load unknown otherwise, raw reps/RIR kept); minutes-only
 *   flows keep the legacy 1 set / 2.5 min as an unknown-dose scenario (energy, mobility and skill credit unchanged) unless
 *   the optional count of genuinely challenging bouts is given.
 */
import type {
  CardioSession,
  ContractionType,
  DoseFieldProvenance,
  EffortScale,
  HealthClassSource,
  HealthIntensityClass,
  IntervalPhase,
  ResistanceSession,
  ResistanceSetGroup,
  RtVolumePreset,
  UnknownDoseScenario,
} from '@/engine/types/schedule';
import type { ExerciseCostBreakdown } from '@/lib/bodyContracts';
import { DEFAULTS, RT_PRESETS, RT_STYLE_MET } from '@/engine/core/defaults';
import { boutCost, sumBoutCosts, type BoutCost } from '@/engine/core/exerciseCost';
import {
  healthClassFromMet,
  healthClassFromRating,
  healthClassFromTalkTest,
  healthEquivalentMinutes,
  rpeEnergyMapApplies,
  type HealthClassK,
} from '@/engine/model/activity/equations';
import { CONTRACTION_TYPE_FACTOR } from '@/engine/model/muscle/equations';
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
  TalkTest,
  TrainingRegion,
} from './types';

// ================================================================== context and results

/** Person-level inputs every energy and intensity term needs. */
export interface StimulusContext {
  bodyMassKg: number;
  /** VO2max, mL/kg/min (engine state or estimate). */
  vo2max: number;
  heightM?: number;
  /**
   * Resting metabolic rate, kcal/d. When present, own rest = RMR·minutes/1440 (the engine's basis, D3-07) and equations use
   * the person's resting VO2 (a modelled intercept); absent = the standard 1 MET (published-equation convention).
   */
  rmrKcalPerDay?: number;
  /** Age, y: the WHO adult aerobic reference applies from 18 (D3-03). Absent = adult. */
  ageYears?: number;
}

/** Where a bout's intensity (and so its energy) came from (D3-03/D3-07). */
export type IntensitySource = 'stated' | 'equation' | 'phases' | 'rpeScenario' | 'catalogue';

/** Public-health class of a bout's aerobic minutes and where it came from (D3-03). */
export interface HealthMinutes {
  /**
   * Guideline minutes of a stated / talk-test / generic relative-effort class; null when some of the minutes have an unknown
   * class (not zero — the known part is `knownModerateMin`/`knownVigorousMin`).
   */
  moderateMin: number | null;
  vigorousMin: number | null;
  /** Aerobic minutes whose class is unknown. */
  unknownMin: number;
  /** A1-021: known moderate / vigorous / light minutes (lower sums kept beside `unknownMin`, never discarded). */
  knownModerateMin: number;
  knownVigorousMin: number;
  lightMin: number;
  /** Class from the catalogue/stated absolute MET (WHO absolute bands): an estimate for a range, never stated minutes. */
  estimatedClass: HealthIntensityClass;
  source: 'stated' | 'talkTest' | 'relativeEffort' | 'phases' | 'unknown';
}

/** Talk test answers (D3-03): sing = light; talk but not sing = moderate; only a few words = vigorous. */
export type TalkTestAnswer = TalkTest;

/** Declared scale of a record's ratings (A1-062): absent = unknown (never reinterpreted as the generic guideline scale). */
export function effortScaleOf(perf: PerformedExercise): EffortScale | undefined {
  return perf.rpeScale;
}
const talkTestOf = (perf: PerformedExercise): TalkTestAnswer | undefined => perf.talkTest;

/** Scale of a phase's rating (A1-062): its own, else only an explicitly declared bout scale (never a guess). */
const phaseScaleOf = (ph: IntervalPhase, perf: PerformedExercise): EffortScale | undefined => ph.rpeScale ?? effortScaleOf(perf);

/** Version of the derived dose / guideline-minute interpretation (A1-021/A1-022/A1-062): derived caches recompute on change. */
export const STIMULUS_DOSE_VERSION = 'stimulus/2026-10-19-a1-021-a1-022-a1-062';

/** Outcome-level evidence of a resolved dose (D3-09): energy, muscle dose, load and effort are certain independently. */
export interface DoseEvidence {
  energy: IntensitySource;
  /** Hard-set dose behind the region credit: reported counts, inferred, a default prescription, or unknown (minutes-only). */
  muscleDose: DoseFieldProvenance;
  /** Weakest provenance among the counted sets' loads and RIRs. */
  load: DoseFieldProvenance;
  effort: DoseFieldProvenance;
}

export interface EnergyEstimate {
  /** Gross kcal of the bout. */
  grossKcal: number;
  /**
   * Net kcal above own rest: max(0, gross − RMR·minutes/1440) with the person's RMR, else above the standard 1 MET,
   * (MET − 1)·3.5·kg/200 per minute (`cost.restBasis` says which). The same net the engine books (D3-07).
   */
  netKcal: number;
  /** P10–P90-style band of the net kcal (MET range, or the equation's certainty floor); a scenario range, not calibrated. */
  netLow: number;
  netHigh: number;
  /** Equation actually used (falls back to `met` when its inputs are missing). */
  method: EnergyEquation;
  /** Effective gross MET of the bout (time-weighted over interval phases). */
  met: number;
  /** D3-07: the labelled ledger terms (gross, own rest, net above rest, displaced lifestyle, incremental). */
  cost: BoutCost;
  /** D3-03: where the intensity came from. */
  intensitySource: IntensitySource;
}

/** One resolved interval phase of a bout (D3-03): minutes at its own gross MET and fraction of VO2max. */
export interface ResolvedPhase {
  kind: IntervalPhase['kind'];
  minutes: number;
  met: number;
  x: number;
  /** The raw rating and its declared scale (A1-062: the phase's own, else the bout's explicit one), kept as entered. */
  rpe?: number;
  rpeScale?: EffortScale;
  /** Guideline class of the phase's minutes and how it was established (A1-021/A1-062); 'unknown' is not zero. */
  healthClass: HealthIntensityClass;
  healthClassSource: HealthClassSource;
}

export interface CardioPart {
  modality: CardioModality;
  minutes: number;
  /** Gross MET (session average). */
  met: number;
  /** Fraction of VO2max, x = MET·3.5/VO2max. */
  x: number;
  /** Moderate-equivalent minutes (engine memWeight(x) × minutes): the heuristic fitness index, not guideline minutes. */
  mem: number;
  /** Minutes at x ≥ hardX (interval bouts: actual work phases only). */
  hiMinutes: number;
  /** Interval phases when logged (D3-03); energy, MEM and hard minutes are their sums. */
  phases?: ResolvedPhase[];
  /**
   * A1-021: booked minutes of the bout beyond its phases (whole bout, before the cardio share), booked at `remainderMet`
   * (the item's catalogue MET, an energy estimate) with an unknown guideline class unless one is stated; and how the phase
   * time line was reconciled with the booked minutes ('scaled' = phases longer than the booked total, proportionally
   * shortened so that the time line sums to the minutes booked).
   */
  remainderMin?: number;
  remainderMet?: number;
  phaseDuration?: 'consistent' | 'remainder' | 'scaled';
  /** Public-health class of these minutes (D3-03). */
  health: HealthMinutes;
  /** A1-021/A1-062: the bout-level rating with its declared scale, kept as entered (never converted). */
  rpe?: number;
  rpeScale?: EffortScale;
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
  /**
   * D3-01 engine input: homogeneous set groups in performed order, offsets from the start of this exercise's resistance
   * part (`sessionSetGroups` puts a session's exercises on one time line).
   */
  groups: ResistanceSetGroup[];
  /** Legacy merged engine input: counted sets × region weight × set-type factor (includes the type factor). */
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
  /** D3-02/D3-09 task descriptors for swaps and exact-same-task matching (qualitative; no efficacy multipliers). */
  task?: string;
  rom?: ExerciseRecord['rom'];
  jointActions?: readonly string[];
  velocity?: ExerciseRecord['velocity'];
  /** D3-07: locomotor steps of this bout inside a total-day step count, when logged. */
  stepsIncluded?: number;
  /** D3-09: provenance of the derived muscle dose (minutes-only records: 'unknown', not zero). */
  doseStatus: DoseFieldProvenance;
  /** A1-022: the named scenario behind the numeric sets when their count is unknown (minutes-only: the legacy conversion). */
  unknownDoseScenario?: UnknownDoseScenario;
  /** D3-09: outcome-level evidence (energy vs muscle dose vs load vs effort). */
  evidence: DoseEvidence;
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
  /** Where the load and the RIR came from (D3-01/D3-09: a default is never a reported hard set). */
  loadSrc: DoseFieldProvenance;
  rirSrc: DoseFieldProvenance;
}

/**
 * D3-03/D3-09: an RPE becomes reps in reserve only on the resistance RIR-based RPE scale (`rpeScale: 'rirRpe'`). A generic
 * CR-10 (breathlessness) rating and a legacy RPE without a scale are not proximity to failure, so they never set RIR.
 */
function rirRpeOf(s: PerformedSet | undefined, perf: PerformedExercise): number | undefined {
  if (perf.rpeScale !== 'rirRpe') return undefined;
  return s?.rpe ?? perf.rpe;
}

/** Hard bouts of a minutes-only record stated at maximal effort count as taken to (near) failure (D3-09). */
const effortRir = (perf: PerformedExercise): number | undefined => (perf.hardBouts !== undefined && perf.effort === 'maximal' ? 0 : undefined);

function rirOf(s: PerformedSet | undefined, perf: PerformedExercise, ex: ExerciseRecord): number {
  const rir = s?.rir ?? perf.rir;
  if (rir !== undefined) return Math.max(0, rir);
  const rpe = rirRpeOf(s, perf);
  if (rpe !== undefined) return clamp(10 - rpe, 0, 10);
  // a set stopped at failure has no reps left; one stopped by technique, skill, time or pain says nothing about failure
  if (perf.stopReason === 'failure') return 0;
  const er = effortRir(perf);
  if (er !== undefined) return er;
  if (ex.defaultDose.rir !== undefined) return ex.defaultDose.rir;
  return ex.loadType === 'ballistic' ? cp('ballisticDefaultRir') : cp('defaultRir');
}

function rirSourceOf(s: PerformedSet | undefined, perf: PerformedExercise): DoseFieldProvenance {
  if ((s?.rir ?? perf.rir) !== undefined) return perf.provenance?.rir ?? 'reported';
  if (rirRpeOf(s, perf) !== undefined) return perf.provenance?.rir ?? 'inferred';
  if (perf.stopReason === 'failure') return 'reported';
  if (effortRir(perf) !== undefined) return 'inferred';
  return 'default';
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

/** True when an item's hard sets come only from minutes (flows, circuits, rounds, mallakhamb; D3-09). */
function minutesOnlyItem(ex: ExerciseRecord): boolean {
  const dd = ex.defaultDose;
  return dd.secPerRound !== undefined || (dd.sets === undefined && dd.rounds === undefined && HARD_SET_LOADS.has(ex.loadType));
}

/** The optional count of genuinely challenging bouts of a minutes-only record, when given (D3-09). */
function hardBoutsOf(ex: ExerciseRecord, perf: PerformedExercise): number | undefined {
  if (perf.hardBouts === undefined || !Number.isFinite(perf.hardBouts) || perf.sets !== undefined) return undefined;
  if (perf.setCount !== undefined || (perf.rounds !== undefined && ex.defaultDose.secPerRound === undefined)) return undefined;
  if (!minutesOnlyItem(ex) || !HARD_SET_LOADS.has(ex.loadType)) return undefined;
  return Math.max(0, perf.hardBouts);
}

/**
 * Number of sets of a log: explicit sets, else the logged count, else (when only minutes are logged) the default count
 * scaled by minutes / default minutes, else the default count. Minute-only resistance items (flows, circuits,
 * mallakhamb) count one set per 2.5 resistance minutes (engine default, 09 §4.13) — a named legacy design scenario with an
 * unknown dose status (D3-09) — unless the optional count of genuinely challenging bouts is given (then that count).
 */
function setCountOf(ex: ExerciseRecord, perf: PerformedExercise): number {
  const dd = ex.defaultDose;
  const hard = hardBoutsOf(ex, perf);
  if (hard !== undefined) return perf.effort === 'light' ? 0 : hard;
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
    const rirSrc = rirSourceOf(s, perf);
    let loadPct: number;
    let loadSrc: DoseFieldProvenance;
    const pct = s.pct1RM ?? perf.pct1RM;
    const kg = s.loadKg ?? perf.loadKg;
    if (pct !== undefined) {
      loadPct = pct;
      loadSrc = 'reported';
    } else if (kg !== undefined && oneRm !== undefined && oneRm > 0) {
      loadPct = (100 * kg) / oneRm;
      loadSrc = 'inferred';
    } else if (reps !== null && ex.loadType !== 'isometric') {
      loadPct = loadPctFromRepsToFailure(reps + rir);
      // D3-09: the generic inversion only inside its domain (dynamic sets, ≤ epleyDomainMaxReps to failure); outside it the
      // %1RM is unknown — the number stays only as the engine's flagged placeholder, the raw reps/RIR are kept
      const inDomain = ex.loadType !== 'ballistic' && reps + rir <= cp('epleyDomainMaxReps');
      // inferred from logged reps or effort; from the item's default reps and RIR it is a default
      loadSrc = !inDomain ? 'unknown' : (s.reps ?? perf.reps) !== undefined || rirSrc !== 'default' ? 'inferred' : 'default';
    } else if (holdSec !== null && reps === null) {
      // a hold: load-independent above 35 %1RM (f_load/f_RIR bypassed); no dynamic %1RM is invented (D3-09)
      loadPct = ENGINE.loadFullPct;
      loadSrc = 'unknown';
    } else {
      loadPct = cp('ballisticDefaultLoadPct');
      loadSrc = ex.loadType === 'ballistic' ? 'unknown' : 'default';
    }
    loadPct = clamp(loadPct, 1, 100);
    if (perf.provenance?.load !== undefined && loadSrc !== 'default' && loadSrc !== 'unknown') loadSrc = perf.provenance.load;

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
    out.push({ weight, reps, holdSec, workSec, loadPct, rir: hold ? 0 : rir, factor, counted, hold, loadSrc, rirSrc });
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
  // D3-03: logged interval phases are the bout's time line when no total is given
  if (perf.intervals && perf.intervals.length > 0) return perf.intervals.reduce((a, p) => a + (p.durationMin > 0 ? p.durationMin : 0), 0);
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
 * Resting VO2 the equations add to their net cost, mL/kg/min: the person's own (from RMR, the engine's convention) when
 * known — a modelled intercept that does not inherit the published equation's validation — else the standard 3.5.
 */
function restVo2Of(ctx: StimulusContext): number {
  const rmr = ctx.rmrKcalPerDay;
  return rmr !== undefined && rmr > 0 && ctx.bodyMassKg > 0 ? (rmr / 1440 / ENGINE.kcalPerLO2) * 1000 / ctx.bodyMassKg : ENGINE.metVo2;
}

/**
 * Version labels of the catalogue's bout equations (SPEC V1.7, 2026-10-27). `acsmWalk` here is a HYBRID — Ludlow & Weyand
 * level cost (when height is known, else ACSM's 0.1·S) plus ACSM's grade term 1.8·S·G — not the published ACSM walking
 * equation; `acsmRun` is ACSM's running equation with the running-economy factor 0.90 on the horizontal term; `cyclePower`
 * is a Compendium fit (2.4·RMR + P/0.26), for LEG cycle ergometers only. The true ACSM forms are `acsmWalkVo2`,
 * `acsmRunVo2` and `acsmCycleVo2` below (used by `speedGradeEstimate`). Existing routes are unchanged; only labelled.
 */
export const EQUATION_VERSION: Readonly<Record<EnergyEquation, string>> = {
  met: 'compendium-met/1',
  ludlowWalk: 'ludlow-walk/1',
  acsmWalk: 'walk-hybrid/1',
  acsmRun: 'run-acsm-economy/1',
  acsmStep: 'acsm-step/1',
  cyclePower: 'cycle-power-fit/1',
  pandolf: 'pandolf/1',
};

// ------------------------------------------------------------------ SPEC V1.7 true ACSM forms and the speed/grade estimator

export const ACSM_WALK_VERSION = 'acsm-walk/1';
export const ACSM_RUN_VERSION = 'acsm-run/1';
export const ACSM_CYCLE_VERSION = 'acsm-cycle/1';
export const DESK_WALK_VERSION = 'compendium-desk-walk/1';

/** ACSM walking, gross VO2 mL/kg/min = 3.5 + 0.1·S + 1.8·S·G; S m/min, G rise/run fraction (5 % = 0.05). */
export const acsmWalkVo2 = (speedMPerMin: number, gradeFrac: number): number => 3.5 + 0.1 * speedMPerMin + 1.8 * speedMPerMin * gradeFrac;
/** ACSM running, gross VO2 mL/kg/min = 3.5 + 0.2·S + 0.9·S·G; S m/min, G fraction. */
export const acsmRunVo2 = (speedMPerMin: number, gradeFrac: number): number => 3.5 + 0.2 * speedMPerMin + 0.9 * speedMPerMin * gradeFrac;
/** ACSM leg ergometry, gross VO2 mL/kg/min = 7 + 1.8·(6.1183·P)/m; P W (6.1183 kgf·m/min per W, exact), m kg. */
export const acsmCycleVo2 = (powerW: number, massKg: number): number => 7 + (1.8 * 6.1183 * powerW) / massKg;
/** Gross kcal of `minutes` at a gross VO2 (mL/kg/min), standard 5 kcal/L. */
export const grossKcalFromVo2 = (vo2: number, massKg: number, minutes: number): number => (vo2 * massKg * minutes * 5) / 1000;

/** ACSM's stated domains (Guidelines for Exercise Testing and Prescription; RESEARCH III.B). */
export const ACSM_DOMAIN = {
  /** Walking 50-100 m/min (1.9-3.7 mph). */
  walkMPerMin: [50, 100] as const,
  /** Running above 134 m/min (5 mph), or from 80 m/min (3 mph) when truly jogging. */
  runMinMPerMin: 134,
  jogMinMPerMin: 80,
  /** Leg ergometry 50-200 W. */
  cycleW: [50, 200] as const,
  /** Treadmill desk: at or below 2 mph the Compendium active-workstation rows are used (11003 ≤ 1 mph, 11004 1-2 mph). */
  deskMaxMPerMin: (2 * 1609.344) / 60,
  deskSlowMaxMPerMin: 1609.344 / 60,
  /** A grade fraction above this is taken as a percent passed by mistake (never extrapolated). */
  maxGradeFrac: 0.4,
} as const;

/** Inputs of the speed/grade estimator. Speeds are belt speed or GPS moving speed; grade null/undefined = unknown. */
export interface SpeedGradeInput {
  gait: 'walk' | 'run' | 'legCycleErgometer';
  massKg: number;
  durationMin: number;
  speedKmh?: number;
  /** Rise/run fraction (5 % = 0.05). Unknown → level is a DECLARED assumption (`gradeAssumedLevel`, wider envelope). */
  gradeFrac?: number | null;
  /** Verified external power, W (leg cycle ergometers only; never rowers, fan bikes or arm ergometers). */
  powerW?: number;
  /** Treadmill belt (enables the ≤ 2 mph treadmill-desk Compendium rows). */
  treadmill?: boolean;
  /** Truly jogging (ACSM run from 80 m/min). */
  jogging?: boolean;
}

/** One speed/grade (or power) estimate: gross energy with its version, scenario envelope and domain flags. */
export interface SpeedGradeEstimate {
  grossKcal: number;
  /** Gross MET equivalent (VO2/3.5). */
  met: number;
  method: 'acsm' | 'compendiumMet';
  version: string;
  envelope: { lo: number; hi: number };
  uncertaintyKind: 'scenario';
  domainFlags: readonly string[];
  /** Compendium code when the desk rows were used. */
  compendiumCode?: '11003' | '11004';
}

/** Scenario half-widths (SPEC §1.5): in-domain speed/grade and verified power ±25 %, matched MET ±30 %; level assumed ±35 % (P). */
const ENV_SPEED = 0.25;
const ENV_LEVEL_ASSUMED = 0.35;
const ENV_MATCHED_MET = 0.3;

function est(grossKcal: number, massKg: number, minutes: number, method: SpeedGradeEstimate['method'], version: string, half: number, flags: string[], code?: '11003' | '11004'): SpeedGradeEstimate {
  const met = (grossKcal * 1000) / (5 * massKg * minutes) / 3.5;
  return { grossKcal, met, method, version, envelope: { lo: grossKcal * (1 - half), hi: grossKcal * (1 + half) }, uncertaintyKind: 'scenario', domainFlags: flags, ...(code ? { compendiumCode: code } : {}) };
}

/**
 * The speed/grade estimator of SPEC V1.7 / V2.4(3): true ACSM walking (50-100 m/min) and running (> 134 m/min, or ≥ 80 when
 * jogging), the Compendium treadmill-desk rows at ≤ 2 mph on a treadmill, and ACSM leg ergometry at 50-200 W of VERIFIED
 * power. Null = outside every domain (the caller falls to the next estimator); never extrapolated: no downhill (G < 0), no
 * walking above 100 m/min, no slow overground walking, no grade that looks like a percent, no power outside 50-200 W. Unknown
 * grade is computed level and flagged. Warrants: empirical-formal B within the stated domains (ACSM; Compendium 2024 for
 * the desk rows), first-principles A for the unit conversion; the envelope is a product scenario (P), not a CI.
 */
export function speedGradeEstimate(i: SpeedGradeInput): SpeedGradeEstimate | null {
  const m = i.massKg;
  const t = i.durationMin;
  if (!(m > 0) || !(t > 0)) return null;
  if (i.gait === 'legCycleErgometer') {
    const p = i.powerW;
    if (p === undefined || !(p >= ACSM_DOMAIN.cycleW[0] && p <= ACSM_DOMAIN.cycleW[1])) return null;
    return est(grossKcalFromVo2(acsmCycleVo2(p, m), m, t), m, t, 'acsm', ACSM_CYCLE_VERSION, ENV_SPEED, []);
  }
  const v = i.speedKmh;
  if (v === undefined || !(v > 0)) return null;
  const S = (v * 1000) / 60;
  const gKnown = i.gradeFrac !== undefined && i.gradeFrac !== null && Number.isFinite(i.gradeFrac);
  const g = gKnown ? (i.gradeFrac as number) : 0;
  if (g < 0 || g > ACSM_DOMAIN.maxGradeFrac) return null;
  const flags = gKnown ? [] : ['gradeAssumedLevel'];
  const half = gKnown ? ENV_SPEED : ENV_LEVEL_ASSUMED;
  if (i.gait === 'walk') {
    if (i.treadmill && S <= ACSM_DOMAIN.deskMaxMPerMin && (!gKnown || g === 0)) {
      const slow = S <= ACSM_DOMAIN.deskSlowMaxMPerMin;
      const met = slow ? 2.0 : 2.8;
      return est((met * 3.5 * 5 * m * t) / 1000, m, t, 'compendiumMet', DESK_WALK_VERSION, ENV_MATCHED_MET, ['treadmillDeskRow'], slow ? '11003' : '11004');
    }
    if (S < ACSM_DOMAIN.walkMPerMin[0] || S > ACSM_DOMAIN.walkMPerMin[1]) return null;
    return est(grossKcalFromVo2(acsmWalkVo2(S, g), m, t), m, t, 'acsm', ACSM_WALK_VERSION, half, flags);
  }
  const min = i.jogging ? ACSM_DOMAIN.jogMinMPerMin : ACSM_DOMAIN.runMinMPerMin;
  if (S < min) return null;
  return est(grossKcalFromVo2(acsmRunVo2(S, g), m, t), m, t, 'acsm', ACSM_RUN_VERSION, half, flags);
}

/**
 * Gross MET of a bout from the item's equation when its inputs are present (R3 §4), else null.
 * VO2 in mL/kg/min; MET = VO2/3.5. `v`/`power` override the log's speed/power (an interval phase).
 */
function equationMet(ex: ExerciseRecord, perf: PerformedExercise, ctx: StimulusContext, phase?: { speedKmh?: number; powerW?: number }): number | null {
  const v = phase?.speedKmh ?? perf.speedKmh;
  const powerW = phase?.powerW ?? perf.powerW;
  const sMin = v !== undefined ? (v * 1000) / 60 : undefined; // m/min
  const g = (perf.gradePct ?? 0) / 100;
  const rest = restVo2Of(ctx);
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
      if (powerW === undefined) return null;
      const rmrPerMin = ctx.rmrKcalPerDay !== undefined ? ctx.rmrKcalPerDay / 1440 : kcalPerMinPerMet(ctx.bodyMassKg);
      const gross = ENGINE.cycleBaselineMult * rmrPerMin + (powerW * 60) / (ENGINE.cycleEff * 4184);
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

/** Interim CR-10 → %VO2max map with explicit intercept/slope (the nominal one, or an edge of its registry range). */
function cardioMetFromRpeWith(rpe: number, ctx: StimulusContext, a: number, b: number): number {
  const x = clamp(a + b * rpe, 0.2, 1.2);
  return (x * ctx.vo2max) / ENGINE.metVo2;
}
function cardioMetFromRpe(rpe: number, ctx: StimulusContext): number {
  return cardioMetFromRpeWith(rpe, ctx, ENGINE.rpeIntercept, ENGINE.rpeSlope);
}
/** D3-03 broad band of a CR-10-only bout: the map at the edges of its registry range (a scenario, not a precise %VO2max). */
function cardioMetBandFromRpe(rpe: number, ctx: StimulusContext): readonly [number, number] {
  const lo = cardioMetFromRpeWith(rpe, ctx, ENGINE.rpeInterceptLow, ENGINE.rpeSlopeLow);
  const hi = cardioMetFromRpeWith(rpe, ctx, ENGINE.rpeInterceptHigh, ENGINE.rpeSlopeHigh);
  return [Math.min(lo, hi), Math.max(lo, hi)];
}

/** Ledger method label of an energy route (C7/D3-07). */
function costMethodOf(method: EnergyEquation, source: IntensitySource): ExerciseCostBreakdown['method'] {
  if (source === 'rpeScenario' || source === 'phases') return 'modelled';
  if (source === 'stated' || source === 'catalogue') return 'compendiumMet';
  if (method === 'cyclePower') return 'power';
  if (method === 'acsmRun' || method === 'acsmStep' || method === 'acsmWalk') return 'acsm';
  return 'modelled';
}

/** Validation domain of the gross route (D3-07: a personal resting intercept is modelled, never the published validation). */
function costDomainOf(method: EnergyEquation, source: IntensitySource, personalRest: boolean): string {
  if (source === 'rpeScenario') return 'interim CR-10 → %VO2max scenario map (unvalidated)';
  if (source === 'stated') return 'stated gross MET';
  if (source === 'phases') return 'interval phases, each by its own intensity';
  if (method === 'met') return 'Compendium 2024 standard MET (3.5 mL O2/kg/min, standard O2 energy equivalent)';
  const name = method === 'ludlowWalk' ? 'Ludlow & Weyand 2016 level walking' : method === 'pandolf' ? 'Pandolf 1977 load carriage' : method === 'cyclePower' ? 'cycling by watts (Compendium fit)' : `ACSM ${method.replace('acsm', '').toLowerCase()} equation`;
  return personalRest && method !== 'pandolf' && method !== 'cyclePower' ? `${name} net cost + own resting VO2 (modelled intercept)` : name;
}

/**
 * Gross MET and fraction of VO2max of one interval phase (D3-03); a phase without an intensity takes the bout's MET. A
 * rating enters the interim CR-10 energy scenario only on the CR10 or an unscaled legacy scale (A1-062).
 */
function phaseMet(ex: ExerciseRecord, perf: PerformedExercise, ph: IntervalPhase, ctx: StimulusContext, fallbackMet: number): number {
  if (ph.met !== undefined && ph.met > 0) return ph.met;
  if (ph.pctVo2max !== undefined && ph.pctVo2max > 0) return (ph.pctVo2max * ctx.vo2max) / ENGINE.metVo2;
  const eq = ph.speedKmh !== undefined || ph.powerW !== undefined ? equationMet(ex, perf, ctx, { ...(ph.speedKmh !== undefined ? { speedKmh: ph.speedKmh } : {}), ...(ph.powerW !== undefined ? { powerW: ph.powerW } : {}) }) : null;
  if (eq !== null) return eq;
  if (ph.rpe !== undefined && rpeEnergyMapApplies(phaseScaleOf(ph, perf))) return cardioMetFromRpe(ph.rpe, ctx);
  return fallbackMet;
}

/**
 * Whole-bout guideline class of a record (A1-062): a stated class (not 'unknown'), else a talk-test answer, else null. It
 * applies to every minute of the bout.
 */
function statedClassOf(perf: PerformedExercise): { cls: HealthIntensityClass; source: HealthClassSource } | null {
  const stated = perf.healthIntensityClass;
  if (stated !== undefined && stated !== 'unknown') return { cls: stated, source: 'stated' };
  const talk = talkTestOf(perf);
  if (talk !== undefined) {
    const c = healthClassFromTalkTest(talk);
    if (c !== 'unknown') return { cls: c, source: 'talkTest' };
  }
  return null;
}

/**
 * Guideline class of one phase (A1-021/A1-062): its own stated class, else the bout's stated/talk-test class, else its
 * rating on the declared generic relative-effort scale (its own scale, else the bout's explicit one); otherwise unknown.
 */
function phaseClassOf(ph: IntervalPhase, perf: PerformedExercise): { cls: HealthIntensityClass; source: HealthClassSource } {
  if (ph.healthIntensityClass !== undefined && ph.healthIntensityClass !== 'unknown') return { cls: ph.healthIntensityClass, source: ph.healthClassSource ?? 'stated' };
  const bout = statedClassOf(perf);
  if (bout) return bout;
  const c = healthClassFromRating(ph.rpe, phaseScaleOf(ph, perf), HEALTH_K);
  return c !== 'unknown' ? { cls: c, source: 'relativeEffort0To10' } : { cls: 'unknown', source: 'unknown' };
}

/** Interval phases of a log resolved to minutes, gross MET, x, rating and class (D3-03, A1-021); null when it has none. */
function resolvePhases(ex: ExerciseRecord, perf: PerformedExercise, ctx: StimulusContext): ResolvedPhase[] | null {
  const ph = perf.intervals;
  if (!ph || ph.length === 0) return null;
  const out: ResolvedPhase[] = [];
  for (const p of ph) {
    const minutes = p.durationMin > 0 ? p.durationMin : 0;
    if (!(minutes > 0)) continue;
    // a remainder segment has no invented intensity: the item's catalogue MET (an energy estimate) and no class of its own
    const met = p.kind === 'remainder' && !(p.met !== undefined && p.met > 0) ? ex.energy.metGross : phaseMet(ex, perf, p, ctx, ex.energy.metGross);
    const scale = phaseScaleOf(p, perf);
    const cls = phaseClassOf(p, perf);
    out.push({
      kind: p.kind,
      minutes,
      met,
      x: (met * ENGINE.metVo2) / ctx.vo2max,
      ...(p.rpe !== undefined ? { rpe: p.rpe, ...(scale !== undefined ? { rpeScale: scale } : {}) } : {}),
      healthClass: cls.cls,
      healthClassSource: cls.source,
    });
  }
  return out.length > 0 ? out : null;
}

/**
 * Energy of a bout of `minutes` (R3 §4; D3-07 shared ledger); band from the MET range or the equation's certainty floor
 * (R5 §2.3). Interval phases (D3-03) are integrated phase by phase; a CR-10-only cardio bout gets the broad band of the
 * scenario map. Net = above own rest: the person's RMR when known, else the standard 1 MET.
 */
export function boutEnergy(ex: ExerciseRecord, perf: PerformedExercise, minutes: number, ctx: StimulusContext): EnergyEstimate {
  const perMet = kcalPerMinPerMet(ctx.bodyMassKg);
  let met = ex.energy.metGross;
  let method: EnergyEquation = 'met';
  let lo = ex.energy.metRange[0];
  let hi = ex.energy.metRange[1];
  let source: IntensitySource = 'catalogue';
  const phases = resolvePhases(ex, perf, ctx);
  const eq = phases ? null : equationMet(ex, perf, ctx);
  if (phases) {
    // time-weighted gross MET of the phases; the remainder of a longer logged bout at the item's own MET
    let pm = 0;
    let pMet = 0;
    for (const p of phases) {
      pm += p.minutes;
      pMet += p.minutes * p.met;
    }
    const rest = minutes > pm ? minutes - pm : 0;
    const tot = pm + rest;
    met = tot > 0 ? (pMet + rest * ex.energy.metGross) / tot : ex.energy.metGross;
    source = 'phases';
    lo = Math.min(lo, met);
    hi = Math.max(hi, met);
  } else if (perf.met !== undefined && perf.met > 0) {
    met = perf.met;
    source = 'stated';
    lo = Math.min(lo, met);
    hi = Math.max(hi, met);
  } else if (eq !== null) {
    met = eq;
    method = ex.energy.equation;
    source = 'equation';
    const z = 1.2816 * cp(BAND_FLOOR[EQUATION_GRADE[method]]!);
    lo = 1 + (met - 1) * (1 - z);
    hi = 1 + (met - 1) * (1 + z);
  } else if (perf.rpe !== undefined && rpeEnergyMapApplies(effortScaleOf(perf)) && (ex.loadType === 'cardio' || ex.hybridCardioShare >= 1)) {
    met = cardioMetFromRpe(perf.rpe, ctx);
    source = 'rpeScenario';
    const band = cardioMetBandFromRpe(perf.rpe, ctx);
    lo = Math.min(lo, band[0], met);
    hi = Math.max(hi, band[1], met);
  }
  const rmr = ctx.rmrKcalPerDay !== undefined && ctx.rmrKcalPerDay > 0 ? ctx.rmrKcalPerDay : null;
  const restPerMin = rmr !== null ? rmr / 1440 : perMet;
  const net = (m: number): number => Math.max(0, m * perMet - restPerMin) * minutes;
  const grossKcal = met * perMet * minutes;
  const cost = boutCost({
    grossKcal,
    durationMin: minutes,
    rmrKcalPerDay: rmr,
    bodyMassKg: ctx.bodyMassKg,
    displacedFracOfRmr: ENGINE.displaced,
    method: costMethodOf(method, source),
    domain: costDomainOf(method, source, rmr !== null),
    source: source === 'stated' ? 'reported' : source === 'equation' || source === 'phases' ? 'derived' : 'estimated',
  });
  return { grossKcal, netKcal: cost.netAboveRestKcal, netLow: net(Math.min(lo, met)), netHigh: net(Math.max(hi, met)), method, met, cost, intensitySource: source };
}

// ================================================================== public-health minutes (D3-03)

/** WHO 2020 class constants as the activity module's equations take them. */
const HEALTH_K: HealthClassK = {
  relModerateMin: ENGINE.healthRelModerateMin,
  relVigorousMin: ENGINE.healthRelVigorousMin,
  absModerateMet: ENGINE.healthAbsModerateMet,
  absVigorousMet: ENGINE.healthAbsVigorousMet,
  vigorousWeight: ENGINE.healthVigorousWeight,
};

/**
 * Public-health minutes of `minutes` aerobic minutes of a bout (D3-03, A1-021, A1-062): a stated class or talk-test answer
 * counts every minute (light counts none); else interval phases are classified phase by phase (their own class, else a
 * rating on the declared generic relative-effort scale; recovery is not vigorous work), the remainder of a longer bout
 * staying unknown; else a whole-bout rating on the declared generic relative-effort scale; else the class is unknown. A Borg
 * CR10, RIR-RPE or unscaled rating alone never classifies (unknown minutes, never known light or zero). Known moderate /
 * vigorous minutes are kept beside unknown ones. The absolute-MET class is kept only as an estimate for a range.
 */
function healthMinutesOf(perf: PerformedExercise, minutes: number, met: number, phases: ResolvedPhase[] | null, remainderMin: number): HealthMinutes {
  const estimatedClass = healthClassFromMet(met, HEALTH_K);
  const m = minutes > 0 ? minutes : 0;
  const result = (mod: number, vig: number, light: number, unk: number, source: HealthMinutes['source']): HealthMinutes => ({
    moderateMin: unk > 1e-9 ? null : mod,
    vigorousMin: unk > 1e-9 ? null : vig,
    unknownMin: unk > 1e-9 ? unk : 0,
    knownModerateMin: mod,
    knownVigorousMin: vig,
    lightMin: light,
    estimatedClass,
    source,
  });
  const bout = statedClassOf(perf);
  if (bout) return result(bout.cls === 'moderate' ? m : 0, bout.cls === 'vigorous' ? m : 0, bout.cls === 'light' ? m : 0, 0, bout.source === 'talkTest' ? 'talkTest' : 'stated');
  if (phases) {
    let mod = 0;
    let vig = 0;
    let light = 0;
    let unk = 0;
    let pm = 0;
    for (const p of phases) {
      pm += p.minutes;
      if (p.healthClass === 'moderate') mod += p.minutes;
      else if (p.healthClass === 'vigorous') vig += p.minutes;
      else if (p.healthClass === 'light') light += p.minutes;
      else unk += p.minutes;
    }
    const rest = remainderMin > 0 ? remainderMin : 0;
    unk += rest;
    // scale the bout's time line to this part's aerobic minutes (a hybrid's cardio share; phases longer than the bout)
    const tot = pm + rest;
    const f = tot > 0 ? m / tot : 0;
    return result(mod * f, vig * f, light * f, unk * f, 'phases');
  }
  const c = healthClassFromRating(perf.rpe, effortScaleOf(perf), HEALTH_K);
  if (c !== 'unknown') return result(c === 'moderate' ? m : 0, c === 'vigorous' ? m : 0, c === 'light' ? m : 0, 0, 'relativeEffort');
  return result(0, 0, 0, m, 'unknown');
}

// ================================================================== set groups (D3-01)

const add = (o: Partial<Record<TrainingRegion, number>>, r: TrainingRegion, v: number): void => {
  if (v !== 0) o[r] = (o[r] ?? 0) + v;
};

/** Contraction type of a set: holds isometric, ballistic items ballistic (when not held), else dynamic. */
function contractionOf(ex: ExerciseRecord, s: SetSpec): ContractionType {
  if (s.hold) return 'isometric';
  return ex.loadType === 'ballistic' ? 'ballistic' : 'dynamic';
}

/** Provenance of the set count: logged sets/counts are reported, a count derived from minutes is inferred. */
function setsSourceOf(ex: ExerciseRecord, perf: PerformedExercise): DoseFieldProvenance {
  if (perf.provenance?.sets !== undefined) return perf.provenance.sets;
  if (perf.sets && perf.sets.length > 0) return 'reported';
  if (hardBoutsOf(ex, perf) !== undefined) return 'reported';
  const logged = perf.setCount !== undefined || perf.rounds !== undefined;
  // round-based flows: hard sets come from resistance time, whatever was logged
  if (ex.defaultDose.secPerRound !== undefined) return logged || perf.minutes !== undefined ? 'inferred' : 'default';
  if (logged) return 'reported';
  return perf.minutes !== undefined ? 'inferred' : 'default';
}

/**
 * Run-length homogeneous groups of the counted sets of one exercise (D3-01), in performed order. Each group covers its
 * share of the resistance minutes (its sets' work + rest time); a non-hard set between two identical runs keeps them
 * apart, so each group covers one contiguous stretch of time. Region weights are raw unless the set-type factor differs
 * from the engine default for the contraction (then they include it, `typeFactorIncluded`), so f_type is applied once.
 */
function setGroupsOf(ex: ExerciseRecord, perf: PerformedExercise, sets: readonly SetSpec[], restSec: number, resistanceMinutes: number): ResistanceSetGroup[] {
  const groups: ResistanceSetGroup[] = [];
  const setsSrc = setsSourceOf(ex, perf);
  const restSrc: DoseFieldProvenance = perf.provenance?.rest ?? (perf.restSec !== undefined ? 'reported' : 'default');
  let totalSec = 0;
  let totalW = 0;
  for (const s of sets) {
    totalSec += s.weight * (workSecOfSet(ex, s) + restSec);
    totalW += s.weight;
  }
  let pos = 0;
  let cur: ResistanceSetGroup | null = null;
  let curKey = '';
  for (const s of sets) {
    const span = totalSec > 0 ? (s.weight * (workSecOfSet(ex, s) + restSec)) / totalSec : totalW > 0 ? s.weight / totalW : 0;
    const startMin = pos * resistanceMinutes;
    const minutes = span * resistanceMinutes;
    pos += span;
    if (!s.counted || s.factor === 0) {
      cur = null;
      curKey = '';
      continue;
    }
    const contraction = contractionOf(ex, s);
    const included = s.factor !== CONTRACTION_TYPE_FACTOR[contraction];
    const key = `${contraction}|${s.factor}|${s.loadPct}|${s.hold ? '' : s.rir}|${s.reps}|${s.hold ? s.holdSec : ''}|${s.loadSrc}|${s.rirSrc}`;
    if (cur !== null && key === curKey) {
      cur.sets += s.weight;
      cur.durationMin = (cur.durationMin ?? 0) + minutes;
      continue;
    }
    const regionWeights: Partial<Record<TrainingRegion, number>> = {};
    for (const [r, w] of Object.entries(ex.regions) as Array<[TrainingRegion, number]>) if (w > 0) regionWeights[r] = included ? w * s.factor : w;
    cur = {
      sets: s.weight,
      regionWeights,
      contraction,
      typeFactorIncluded: included,
      loadPct1RM: s.loadPct,
      ...(s.hold ? {} : { rir: s.rir }),
      restSec,
      ...(s.reps !== null ? { reps: s.reps } : {}),
      ...(s.hold && s.holdSec !== null ? { holdSec: s.holdSec } : {}),
      exerciseId: ex.id,
      startOffsetMin: startMin,
      durationMin: minutes,
      provenance: { sets: setsSrc, regions: 'inferred', load: s.loadSrc, ...(s.hold ? {} : { rir: s.rirSrc }), rest: restSrc },
    };
    curKey = key;
    groups.push(cur);
  }
  return groups;
}

/**
 * The set groups of a session's doses on one time line (D3-01): offsets from the start of the resistance part, exercises in
 * order as `toEngineDose` books their resistance minutes (energy-only items are booked as cardio and take no resistance
 * time). Every group of every exercise is kept: no slot limit, no averaging.
 */
export function sessionSetGroups(doses: readonly ExerciseDose[]): ResistanceSetGroup[] {
  const out: ResistanceSetGroup[] = [];
  let base = 0;
  for (const d of doses) {
    // toEngineDose books resistance minutes exactly for items with hard sets; the rest is cardio ('other') or nothing
    if (!(d.sets > 0)) continue;
    for (const g of d.groups) {
      out.push({
        ...g,
        regionWeights: { ...g.regionWeights },
        startOffsetMin: base + (g.startOffsetMin ?? 0),
        ...(g.provenance ? { provenance: { ...g.provenance } } : {}),
      });
    }
    base += d.resistanceMinutes;
  }
  return out;
}

// ================================================================== resolve one exercise

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

  // D3-09: a minutes-only record (flow, circuit, rounds) keeps the legacy 1 set / 2.5 min as a scenario whose dose is
  // unknown — never known hard sets, never a known zero
  const minutesOnly =
    HARD_SET_LOADS.has(ex.loadType) &&
    hardBoutsOf(ex, perf) === undefined &&
    !(perf.sets && perf.sets.length > 0) &&
    (ex.defaultDose.secPerRound !== undefined || (minutesOnlyItem(ex) && perf.setCount === undefined && perf.rounds === undefined));
  const groups = setGroupsOf(ex, perf, sets, restSec, resistanceMinutes);
  if (minutesOnly) for (const g of groups) g.provenance = { ...g.provenance, sets: 'unknown' };
  const energy = boutEnergy(ex, perf, minutes, ctx);
  let cardio: CardioPart | null = null;
  if (cardioMinutes > 0) {
    const x = (energy.met * ENGINE.metVo2) / ctx.vo2max;
    const phases = energy.intensitySource === 'phases' ? resolvePhases(ex, perf, ctx) : null;
    let mem = memWeight(x) * cardioMinutes;
    let hiMinutes = x >= ENGINE.hardX ? cardioMinutes : 0;
    let restMin = 0;
    let phaseDuration: CardioPart['phaseDuration'];
    if (phases) {
      // D3-03: MEM and hard minutes phase by phase (work and recovery at their own intensity), scaled to the cardio share
      let pm = 0;
      let pMem = 0;
      let pHi = 0;
      for (const ph of phases) {
        pm += ph.minutes;
        pMem += memWeight(ph.x) * ph.minutes;
        if (ph.x >= ENGINE.hardX) pHi += ph.minutes;
      }
      // A1-021: booked minutes beyond the phases are an unknown-class remainder at the item's catalogue MET; phases longer
      // than the booked total are proportionally shortened (the time line always sums to the minutes booked)
      restMin = minutes > pm ? minutes - pm : 0;
      phaseDuration = Math.abs(minutes - pm) <= 1e-9 * Math.max(1, minutes) ? 'consistent' : restMin > 0 ? 'remainder' : 'scaled';
      const xRest = (ex.energy.metGross * ENGINE.metVo2) / ctx.vo2max;
      pMem += memWeight(xRest) * restMin;
      if (xRest >= ENGINE.hardX) pHi += restMin;
      const f = pm + restMin > 0 ? cardioMinutes / (pm + restMin) : 0;
      mem = pMem * f;
      hiMinutes = pHi * f;
    }
    const scale = effortScaleOf(perf);
    cardio = {
      modality: ex.cardioModality ?? 'other',
      minutes: cardioMinutes,
      met: energy.met,
      x,
      mem,
      hiMinutes,
      ...(phases ? { phases, remainderMin: restMin, remainderMet: ex.energy.metGross, ...(phaseDuration ? { phaseDuration } : {}) } : {}),
      health: healthMinutesOf(perf, cardioMinutes, energy.met, phases, restMin),
      ...(perf.rpe !== undefined ? { rpe: perf.rpe, ...(scale !== undefined ? { rpeScale: scale } : {}) } : {}),
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

  // D3-09 outcome-level evidence: energy, muscle dose, load and effort are certain independently; minutes-only records keep
  // the legacy set scenario with an unknown dose status (never a known zero, never known hard sets)
  const doseStatus: DoseFieldProvenance = minutesOnly ? 'unknown' : setsSourceOf(ex, perf);
  let loadEv: DoseFieldProvenance = 'reported';
  let effortEv: DoseFieldProvenance = 'reported';
  for (const s of sets) {
    if (!s.counted || s.factor === 0) continue;
    loadEv = weakerProvenance(loadEv, s.loadSrc);
    effortEv = weakerProvenance(effortEv, s.hold ? (s.factor === 1 ? 'reported' : 'default') : s.rirSrc);
  }
  if (counted === 0) {
    loadEv = 'unknown';
    effortEv = 'unknown';
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
    groups,
    setsByRegion,
    effectiveSetsByRegion: eff,
    perSetCredit,
    cardio,
    mobilityMinutes,
    energy,
    tauSd: ex.status === 'mapped' ? exerciseTau(ex).sigmaLog : 0,
    regionRoles: { ...ex.regions },
    ...(ex.task !== undefined ? { task: ex.task } : {}),
    ...(ex.rom !== undefined ? { rom: ex.rom } : {}),
    ...(ex.jointActions !== undefined ? { jointActions: ex.jointActions } : {}),
    ...(ex.velocity !== undefined ? { velocity: ex.velocity } : {}),
    ...(perf.stepsIncluded !== undefined && Number.isFinite(perf.stepsIncluded) ? { stepsIncluded: Math.max(0, perf.stepsIncluded) } : {}),
    doseStatus,
    ...(minutesOnly ? { unknownDoseScenario: 'legacyMinuteConversion' as const } : {}),
    evidence: { energy: energy.intensitySource, muscleDose: doseStatus, load: loadEv, effort: effortEv },
  };
}

const PROVENANCE_RANK: Readonly<Record<DoseFieldProvenance, number>> = { reported: 0, inferred: 1, default: 2, unknown: 3 };
/** The weaker of two provenances (reported < inferred < default < unknown). */
export function weakerProvenance(a: DoseFieldProvenance, b: DoseFieldProvenance): DoseFieldProvenance {
  return PROVENANCE_RANK[b] > PROVENANCE_RANK[a] ? b : a;
}

// ================================================================== aggregate to the stimulus vector

/**
 * Additive A1-021 guideline-minute detail of a stimulus vector (optional; absent on stored legacy vectors): the known
 * moderate / vigorous minutes and the unknown-class aerobic minutes, so a partly unknown session keeps its known lower sums
 * (`healthModerateMin`/`healthVigorousMin` stay null whenever some minutes are unknown).
 */
export interface StimulusVectorExtras {
  healthKnownModerateMin?: number;
  healthKnownVigorousMin?: number;
  healthUnknownMin?: number;
}
export type StimulusVectorDetail = StimulusVector & StimulusVectorExtras;

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
  // D3-03 guideline minutes: known sums, null as soon as any aerobic minutes have an unknown class
  let hMod: number | null = 0;
  let hVig: number | null = 0;
  // A1-021: known lower sums and unknown-class minutes, kept beside the null-when-unknown totals
  let kMod = 0;
  let kVig = 0;
  let hUnk = 0;
  let anyCardio = false;
  let anyMobility = false;
  let classSource: HealthClassSource = 'unknown';
  let unknownScenario: UnknownDoseScenario | undefined;
  let doseStatus: DoseFieldProvenance | undefined;
  for (const d of doses) {
    if (d.cardio) {
      const h = d.cardio.health;
      hMod = hMod === null || h.moderateMin === null ? null : hMod + h.moderateMin;
      hVig = hVig === null || h.vigorousMin === null ? null : hVig + h.vigorousMin;
      kMod += h.knownModerateMin;
      kVig += h.knownVigorousMin;
      hUnk += h.unknownMin;
      const src = HEALTH_SOURCE_OF[h.source];
      classSource = !anyCardio ? src : classSource === src ? classSource : 'unknown';
      anyCardio = true;
    }
    if (Object.keys(d.mobilityMinutes).length > 0) anyMobility = true;
    if (d.unknownDoseScenario !== undefined) unknownScenario = d.unknownDoseScenario;
    if (d.sets > 0 || d.doseStatus === 'unknown') doseStatus = doseStatus === undefined ? d.doseStatus : weakerProvenance(doseStatus, d.doseStatus);
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
    if (d.sets > 0 && RESISTANCE_PATTERNS.has(d.pattern)) {
      // D3-02: identity, task and range of motion travel with the work (exact-same-task matching; pattern + implement alone
      // never establishes it)
      strength.push({
        pattern: d.pattern,
        implement: d.implement,
        sets: d.sets,
        loadPct: d.meanLoadPct,
        exerciseId: d.exerciseId,
        ...(d.task !== undefined ? { task: d.task } : {}),
        ...(d.rom !== undefined ? { rom: d.rom } : {}),
      });
    }
    const w = d.creditedSets > 0 ? 1000 + d.creditedSets : d.minutes;
    if (w > domWeight) {
      domWeight = w;
      domPattern = d.pattern;
    }
  }
  const meanLoad = sets > 0 ? sumLoad / sets : 0;
  const setGroups = sessionSetGroups(doses);
  const vector: StimulusVectorDetail = {
    effectiveSetsByRegion: eff,
    // D3-01: effective sets include every factor (type factor too); the engine dose comes from the groups
    typeFactorIncluded: true,
    ...(setGroups.length > 0 ? { setGroups } : {}),
    physicalSets: sets,
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
    healthModerateMin: hMod,
    healthVigorousMin: hVig,
    cost: sumBoutCosts(doses.map((d) => d.energy.cost)),
    ...(doseStatus !== undefined ? { doseStatus } : {}),
    ...(anyCardio ? { healthKnownModerateMin: kMod, healthKnownVigorousMin: kVig, healthUnknownMin: hUnk, healthClassSource: classSource } : {}),
    ...(unknownScenario !== undefined ? { unknownDoseScenario: unknownScenario } : {}),
    // A1-022: per-outcome dose status — an unknown hard-set count leaves hypertrophy/strength unknown while energy, cardio
    // and mobility (from the logged minutes) stay independently known
    ...(doses.length > 0
      ? {
          outcomeDoseStatus: {
            ...(doseStatus !== undefined ? { hypertrophy: doseStatus, strength: doseStatus } : {}),
            energy: 'inferred' as const,
            ...(anyCardio ? { cardio: 'inferred' as const } : {}),
            ...(anyMobility ? { mobility: 'inferred' as const } : {}),
          },
        }
      : {}),
  };
  return vector;
}

/** How each per-dose guideline result was established, as the vector's `healthClassSource` (A1-062). */
const HEALTH_SOURCE_OF: Readonly<Record<HealthMinutes['source'], HealthClassSource>> = {
  stated: 'stated',
  talkTest: 'talkTest',
  relativeEffort: 'relativeEffort0To10',
  phases: 'unknown',
  unknown: 'unknown',
};

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
  /**
   * The resistance part: `groups` (D3-01) carry the dose — every homogeneous set group with its own load/RIR/rest/
   * contraction; the engine applies f_RIR, f_load, f_rest and f_type per group. `setsByRegion` (counted sets × region weight
   * × set-type factor, `setsByRegionIncludesTypeFactor`) and the session rir/loadPct1RM/restSec are legacy summaries.
   */
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

/** One segment of an engine cardio time line (A1-021): minutes at its own gross MET, with its class and raw rating. */
interface CardioSegments {
  minutes: number;
  metMin: number;
  segs: IntervalPhase[];
  /** True when a contributing dose had a real phase structure (interval phases or an unknown remainder). */
  structured: boolean;
  steps: number;
  anySteps: boolean;
}

/** The one class every minute of a dose's cardio part has (A1-021), else null (mixed or partly unknown). */
function wholeClassOf(h: HealthMinutes, minutes: number): { cls: HealthIntensityClass; source: HealthClassSource } | null {
  if (h.unknownMin > 1e-9 || !(minutes > 0)) return null;
  const tol = 1e-9 * Math.max(1, minutes);
  const cls: HealthIntensityClass | null =
    Math.abs(h.knownModerateMin - minutes) <= tol ? 'moderate' : Math.abs(h.knownVigorousMin - minutes) <= tol ? 'vigorous' : Math.abs(h.lightMin - minutes) <= tol ? 'light' : null;
  return cls ? { cls, source: HEALTH_SOURCE_OF[h.source] } : null;
}

const ratingOf = (rpe: number | undefined, scale: EffortScale | undefined): Pick<IntervalPhase, 'rpe' | 'rpeScale'> =>
  rpe !== undefined ? { rpe, ...(scale !== undefined ? { rpeScale: scale } : {}) } : {};
const classOf = (cls: HealthIntensityClass | undefined, source: HealthClassSource | undefined): Pick<IntervalPhase, 'healthIntensityClass' | 'healthClassSource'> =>
  cls !== undefined && cls !== 'unknown' ? { healthIntensityClass: cls, ...(source !== undefined ? { healthClassSource: source } : {}) } : {};

/**
 * The engine time-line segments of one dose's cardio part (A1-021), in order: its interval phases (each at its resolved
 * gross MET, with its class and raw rating/scale) and the unknown-class remainder of a longer bout at the item's catalogue
 * MET; a dose without phases is one steady segment at its own MET. Durations are scaled to the cardio part's minutes so the
 * segments sum exactly to the minutes booked (a hybrid's cardio share; phases longer than the booked total).
 */
function doseSegments(d: ExerciseDose): IntervalPhase[] {
  const c = d.cardio!;
  const src = { exerciseId: d.exerciseId };
  if (c.phases && c.phases.length > 0) {
    let pm = 0;
    for (const p of c.phases) pm += p.minutes;
    const rest = c.remainderMin !== undefined && c.remainderMin > 0 ? c.remainderMin : 0;
    const tot = pm + rest;
    const f = tot > 0 ? c.minutes / tot : 0;
    const out: IntervalPhase[] = c.phases.map((p) => ({ kind: p.kind, durationMin: p.minutes * f, met: p.met, ...ratingOf(p.rpe, p.rpeScale), ...classOf(p.healthClass, p.healthClassSource), ...src }));
    if (rest > 0) {
      // a stated / talk-test whole-bout class covers the remainder too; otherwise it stays unknown (no invented class)
      const whole = c.health.source === 'stated' || c.health.source === 'talkTest' ? wholeClassOf(c.health, c.minutes) : null;
      out.push({ kind: 'remainder', durationMin: rest * f, met: c.remainderMet ?? c.met, ...classOf(whole?.cls, whole?.source), ...src });
    }
    return out;
  }
  const whole = wholeClassOf(c.health, c.minutes);
  return [{ kind: 'steady', durationMin: c.minutes, met: c.met, ...ratingOf(c.rpe, c.rpeScale), ...classOf(whole?.cls, whole?.source), ...src }];
}

/**
 * D3-03/D3-07/A1-021 additions of an engine cardio part built from its segments: the ordered time line as `phases` when the
 * part has more than one segment or a real phase structure (each segment keeps its own MET, class and rating, so the engine
 * integrates the same energy, MEM, hard minutes and EPOC as the catalogue), the whole-part class only when every minute has
 * it, the raw rating/scale of a single steady dose, and the locomotor steps inside a total-day count.
 */
function cardioExtras(c: CardioSegments): Pick<CardioSession, 'phases' | 'healthIntensityClass' | 'healthClassSource' | 'rpe' | 'rpeScale' | 'stepsIncluded'> {
  const out: Pick<CardioSession, 'phases' | 'healthIntensityClass' | 'healthClassSource' | 'rpe' | 'rpeScale' | 'stepsIncluded'> = {};
  const segs = c.segs;
  if (segs.length > 1 || c.structured) out.phases = segs;
  let cls: HealthIntensityClass | undefined;
  let source: HealthClassSource | undefined;
  let same = segs.length > 0;
  for (const g of segs) {
    const gc = g.healthIntensityClass ?? 'unknown';
    if (gc === 'unknown') same = false;
    if (cls === undefined) {
      cls = gc;
      source = g.healthClassSource;
    } else if (cls !== gc) same = false;
    else if (source !== g.healthClassSource) source = undefined;
  }
  if (same && cls !== undefined && cls !== 'unknown') {
    out.healthIntensityClass = cls;
    if (source !== undefined) out.healthClassSource = source;
  }
  if (segs.length === 1 && !c.structured && segs[0]!.rpe !== undefined) {
    out.rpe = segs[0]!.rpe;
    if (segs[0]!.rpeScale !== undefined) out.rpeScale = segs[0]!.rpeScale;
  }
  if (c.anySteps) out.stepsIncluded = c.steps;
  return out;
}

/**
 * Compile resolved doses into engine schedule sessions starting at `startH` (resistance first, then cardio parts, on the
 * bout's own clock: a part after midnight keeps a start of 24:00 or later, which the compiler steps in the next day's
 * hours). `sessionId` is the bout's stable identity (log entry or prescription slot), carried to every part: the bare id
 * for a one-part bout, `id#k` per part otherwise (resistance first) — the replay convention for engine sessions without
 * an id (living `toLoggedDay`), so a stored derived dose and a recompiled one name the same parts alike.
 *
 * Cardio (A1-021): one part per modality whose time line is the ordered concatenation of every contributing dose's segments
 * (phases, steady doses, remainders), never a mean MET over records. Resistance (A1-022): a part whose hard-set count is
 * unknown in every dose says so (`doseStatus: 'unknown'`), and any unknown-count group names its scenario
 * (`unknownDoseScenario`); the group-level provenance keeps known and unknown counts apart.
 */
export function toEngineDose(doses: readonly ExerciseDose[], startH: number, opts: { sessionId?: string } = {}): EngineTrainingDose {
  const setsByRegion: Partial<Record<TrainingRegion, number>> = {};
  let rMin = 0;
  let rMetMin = 0;
  let sets = 0;
  let sRir = 0;
  let sLoad = 0;
  let sRest = 0;
  let anyUnknownDose = false;
  let allUnknownDose = true;
  let knownDoseStatus: DoseFieldProvenance | undefined;
  const cardioBy = new Map<CardioModality, CardioSegments>();
  const part = (m: CardioModality): CardioSegments => {
    let c = cardioBy.get(m);
    if (!c) {
      c = { minutes: 0, metMin: 0, segs: [], structured: false, steps: 0, anySteps: false };
      cardioBy.set(m, c);
    }
    return c;
  };
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
      // no hard sets (stretching, mobility flows): energy only, booked as light 'other' activity at the item's own MET (a
      // steady segment of unknown guideline class)
      const c = part('other');
      c.minutes += d.resistanceMinutes;
      c.metMin += d.resistanceMinutes * d.energy.met;
      c.segs.push({ kind: 'steady', durationMin: d.resistanceMinutes, met: d.energy.met, exerciseId: d.exerciseId });
    } else if (d.resistanceMinutes > 0 || d.sets > 0) {
      rMin += d.resistanceMinutes;
      rMetMin += d.resistanceMinutes * d.energy.met;
      sets += d.sets;
      sRir += d.meanRir * d.sets;
      sLoad += d.meanLoadPct * d.sets;
      sRest += d.restSec * d.sets;
      if (d.sets > 0) {
        if (d.doseStatus === 'unknown') anyUnknownDose = true;
        else {
          allUnknownDose = false;
          knownDoseStatus = knownDoseStatus === undefined ? d.doseStatus : weakerProvenance(knownDoseStatus, d.doseStatus);
        }
      }
    }
    if (d.cardio) {
      const c = part(d.cardio.modality);
      c.minutes += d.cardio.minutes;
      c.metMin += d.cardio.minutes * d.cardio.met;
      for (const g of doseSegments(d)) c.segs.push(g);
      if (d.cardio.phases && d.cardio.phases.length > 0) c.structured = true;
      const v = d.stepsIncluded;
      if (v !== undefined && Number.isFinite(v) && v > 0) {
        c.steps += v;
        c.anySteps = true;
      }
    }
  }
  const hasSets = Object.values(setsByRegion).some((v) => (v ?? 0) > 0);
  let resistance: ResistanceSession | null = null;
  let resistanceMet: number | null = null;
  if (hasSets || rMin > 0) {
    resistanceMet = rMin > 0 ? rMetMin / rMin : null;
    const groups = sessionSetGroups(doses);
    const doseStatus: DoseFieldProvenance | undefined = anyUnknownDose && allUnknownDose ? 'unknown' : knownDoseStatus;
    resistance = {
      kind: 'resistance',
      startH,
      durationMin: rMin,
      setsByRegion,
      setsByRegionIncludesTypeFactor: true,
      // legacy summaries (set-weighted); the dose is in `groups` when present
      rir: sets > 0 ? sRir / sets : cp('defaultRir'),
      loadPct1RM: sets > 0 ? sLoad / sets : cp('ballisticDefaultLoadPct'),
      restSec: sets > 0 ? sRest / sets : 0,
      style: nearestStyle(resistanceMet ?? RT_STYLE_MET.general),
      ...(resistanceMet !== null && resistanceMet > 0 ? { met: resistanceMet } : {}),
      ...(groups.length > 0 ? { groups } : {}),
      ...(doseStatus !== undefined ? { doseStatus } : {}),
      ...(anyUnknownDose ? { unknownDoseScenario: 'legacyMinuteConversion' as const } : {}),
    };
  }
  const cardio: CardioSession[] = [];
  let t = startH + rMin / 60;
  for (const [modality, c] of [...cardioBy.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (c.minutes <= 0) continue;
    // never wrapped to the same day's morning (D3-01: no fabricated start times; the compiler carries past midnight)
    cardio.push({ kind: 'cardio', modality, startH: t, durationMin: c.minutes, met: c.metMin / c.minutes, ...cardioExtras(c) });
    t += c.minutes / 60;
  }
  if (opts.sessionId !== undefined) {
    const parts: Array<ResistanceSession | CardioSession> = resistance ? [resistance, ...cardio] : cardio;
    parts.forEach((p, k) => (p.sessionId = parts.length > 1 ? `${opts.sessionId}#${k}` : opts.sessionId));
  }
  return { resistance, resistanceMet, cardio, energy: { grossKcal: gross, netKcal: net, netLow: lo, netHigh: hi } };
}

// ================================================================== weekly dose vs presets and minimum effective doses (R3 §3.4)

/** Status of the WHO adult lower aerobic reference for a week (D3-03); not a complete health certificate. */
export type AerobicReferenceStatus = 'met' | 'notMet' | 'unknown' | 'notApplicable';

export interface WeeklyDose {
  /** Effective sets per region per week. */
  setsByRegion: Partial<Record<TrainingRegion, number>>;
  /** Heuristic fitness dose index (moderate-equivalent minutes by relative intensity); not guideline minutes. */
  mem: number;
  hiMinutes: number;
  netKcal: number;
  /** Largest engine RT preset (09 §4.1) whose weekly sets the mean major region reaches; null below 'minimal'. */
  preset: RtVolumePreset | null;
  /** Trained regions below the hypertrophy minimum effective dose (4 effective sets/wk). */
  belowMinimum: TrainingRegion[];
  /** Fitness MEM index ≥ its 150 heuristic reference (D3-03: a training-dose index, NOT the WHO guideline). */
  memMet: boolean;
  /** ≥ 30 min/wk at ≥ 0.85 VO2max (engine VO2max maintenance reference). */
  vo2MaintenanceMet: boolean;
  /**
   * D3-03 public-health aerobic minutes per week: moderate and vigorous minutes of a stated / talk-test / relative-exertion
   * class, and their moderate-equivalent sum M + 2V. Null when some aerobic minutes have an unknown class (not zero).
   */
  healthModerateMin: number | null;
  healthVigorousMin: number | null;
  healthEquivalentMin: number | null;
  /** min/week: the known equivalent minutes up to the case that every unknown minute were vigorous (a range, not a guess). */
  healthEquivalentRange: readonly [number, number];
  /** WHO adult lower aerobic reference (150 min/wk moderate-equivalent; adults only): met / not met / unknown / not applicable. */
  aerobicReference: AerobicReferenceStatus;
}

/**
 * Sum a week of session stimuli and compare with the engine presets and R3 §3.4 minimum effective doses. D3-03: guideline
 * aerobic minutes are summed separately from the fitness MEM index; with unknown-class minutes the equivalent minutes are a
 * range and the adult reference is 'unknown' unless the known minutes alone already reach it.
 */
export function weeklyDose(week: readonly StimulusVector[], opts: { ageYears?: number } = {}): WeeklyDose {
  const sets: Partial<Record<TrainingRegion, number>> = {};
  let mem = 0;
  let hi = 0;
  let net = 0;
  let mod = 0;
  let vig = 0;
  let unknownMin = 0;
  for (const v of week) {
    for (const [r, x] of Object.entries(v.effectiveSetsByRegion) as Array<[TrainingRegion, number]>) add(sets, r, x);
    mem += v.mem;
    hi += v.hiMinutes;
    net += v.netKcal;
    const det = v as StimulusVectorDetail;
    if (det.healthKnownModerateMin !== undefined) {
      // A1-021: the known moderate / vigorous minutes count even when other minutes of the session have an unknown class
      mod += det.healthKnownModerateMin;
      vig += det.healthKnownVigorousMin ?? 0;
      unknownMin += det.healthUnknownMin ?? 0;
    } else if (v.healthModerateMin === null || v.healthVigorousMin === null) {
      // unknown class: its aerobic minutes (the cardio part, = MEM / MEM per minute; else the bout's minutes as an upper
      // bound) are unknown, not zero
      unknownMin += v.memPerMin !== undefined && v.memPerMin > 0 ? v.mem / v.memPerMin : v.minutes !== undefined ? Math.max(0, v.minutes) : 0;
    } else {
      mod += v.healthModerateMin ?? 0;
      vig += v.healthVigorousMin ?? 0;
    }
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
    ...healthWeek(mod, vig, unknownMin, opts.ageYears),
  };
}

/** D3-03 weekly guideline accounting from known moderate/vigorous minutes and unknown-class minutes. */
function healthWeek(mod: number, vig: number, unknownMin: number, ageYears: number | undefined): Pick<WeeklyDose, 'healthModerateMin' | 'healthVigorousMin' | 'healthEquivalentMin' | 'healthEquivalentRange' | 'aerobicReference'> {
  const known = healthEquivalentMinutes(mod, vig, HEALTH_K);
  const hiEq = known + ENGINE.healthVigorousWeight * unknownMin;
  const unknown = unknownMin > 1e-9;
  const ref = ENGINE.healthAerobicLowerMinWk;
  const aerobicReference: AerobicReferenceStatus =
    ageYears !== undefined && ageYears < 18 ? 'notApplicable' : known >= ref - 1e-9 ? 'met' : unknown && hiEq >= ref - 1e-9 ? 'unknown' : 'notMet';
  return {
    healthModerateMin: unknown ? null : mod,
    healthVigorousMin: unknown ? null : vig,
    healthEquivalentMin: unknown ? null : known,
    healthEquivalentRange: [known, hiEq],
    aerobicReference,
  };
}

/** D3-03 guideline class of a talk-test answer (re-exported for intake/logging surfaces). */
export { healthClassFromTalkTest } from '@/engine/model/activity/equations';
