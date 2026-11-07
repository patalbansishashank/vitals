/**
 * MODULE muscle — resistance-training stimulus, hypertrophy accretion, lean retention in deficit, detraining & muscle
 * memory, strength, fatigue; hourly MPS display layer and the post-exercise MPS kernel.
 * Spec: docs/MODEL_SPEC.md §1.9 · Dossiers: 09 §4.1-4.17 (owner of every RT effect, incl. f_P per kg body mass — R-RT
 * revised); 03 §4.2 (7-day effective intake), §4.10 (quality), §4.5, §4.7 (hourly layer, display only), §4.8 (E_dist on A_r), §4.10 (quality), §4.14 (anabolic resistance display);
 * 15 §4.10/§4.12 (alcohol MPS multiplier, creatine multiplier); 16 §4.0.1 (sleep multiplier); 19 §4.3 (M_EA on strength);
 * 21 §4D-4 (post-RT cold-water immersion multiplier, `SessionResolved.coldWaterImmersion`).
 * Owned files: src/engine/model/muscle/** only.
 *
 * Structure (MODEL_SPEC §1.9):
 *  - stepHour: effective sets (09 §4.1) per region → 09 kernel S_mps,r (→ `mpsStimWb`) and 03 X_RT; 03 §4.7B MPS index
 *    (display only, never integrated into mass); post-session alcohol/protein window (15 §4.10).
 *  - endOfDay: 7-day set ring → V_r, F_r; habituation H_r, swelling W_r; accretion A_r (09 §4.9 with 09 f_P on 7-day
 *    quality-weighted protein per kg body mass, f_EP on the 7-day mean e, 03 E_dist); detraining D_r (09 §4.10); fatigue (09 §4.11); neural strength N (09 §4.14, R-STR); daily signals.
 *  - Burn-in (clock.day < 0, the habitual week with its sessions, R-BURNIN): every state runs (set ring, habituation,
 *    fatigue, neural strength, protein ring, MPS layer) except the training-attributable mass (M_acc, M_peak frozen at
 *    their 09 §4.6 initial values) and events. `endBurnIn` latches the t = 0 references: M_acc,0, SM₀, the neural
 *    component at its habitual equilibrium, and the habitual-week means of acute fatigue and M_EA, so that at t = 0
 *    rtMuscleGain = smRtKg = 0 and strength = 100, and the strength index averages 100 over the habitual week.
 *
 * Habitual-training equilibrium (MODEL_SPEC §1.9, R-BURNIN/O-12) as a labelled growth scenario (D3-05, 2026-10-18): with RT
 * in the habitual week, `endBurnIn` latches the reference rate B_ref,r = the gross 09 §4.9 accretion rate the habitual week
 * produces at maintenance and habitual protein, and accretion is the excess max(0, B_r − B_ref,r) — scenario 'stable'.
 * That is a NUMERICAL burn-in anchor, not a measured plateau: the training growth state (progressing / plateaued /
 * resuming / unknown, `HabitProfile.trainingGrowthState` with its source) selects it. Unknown keeps the stable anchor as the
 * nominal (assumption `growthBurnInAnchor`) and the competing 'progress' scenario (accretion = B_r, existing caps) through
 * `muscle.growthScenarioUnknown`; a stated 'plateaued' uses the reference, 'progressing'/'resuming' the progress scenario.
 * A legacy "currently training" profile is unknown, never plateaued. Without RT in the habitual week B_ref = 0 (novice gains
 * when training starts) and all of M_acc,0 is the person's set-point (`mBase`, never detrained).
 *
 * Detraining (D3-06, 2026-10-18; supersedes R-DETRAIN's guaranteed floor): 09 §4.10's exponential loss (no loss for ~2-3
 * weeks, then τ_d) acts on M_acc − floor. The untrained, FFMI-derived set-point (`mBase` = M_acc,0 minus the trained gains
 * the body carries above FFMI_untr, `equations.trainedGains0`) is never detrained by this module (composition owns disuse
 * and illness catabolism, so nothing is lost twice). The retained share of trained gains `detrainFloorFrac` is 0 centrally
 * — no permanent 50 % guarantee — and a nonzero research scenario follows the attained peak (history), never the run
 * origin, so gains accrued before and inside a run detrain alike. Peaks, low-volume clocks, set rings and habituation live
 * in this state, so a day-stamped snapshot continues one history bit-identically across replans and horizons.
 *
 * Regain (ruling R-REGAIN, 2026-10-01): below M_peak (only reachable through detraining) accretion is 09's full rate B_r
 * (gap term, habituation) capped at M_peak; the excess form over B_ref applies at/above it. The ×1.3 memory boost is the
 * named scenario `muscle.kMem` = 1.3; the central value is the neutral 1 (D3-06).
 *
 * Meal distribution (D3-04): E_dist = 1 in production (every draw; `muscle.eDistMode` 1 = the legacy 03 §4.8 curve as a
 * research sensitivity). Daily protein stays the primary pathway; the MPS index is an exploratory display layer (never
 * integrated into mass, measured fractional synthesis or tissue gain).
 *
 * Set groups (D3-01, 2026-10-18): when the compiler resolves homogeneous set groups (`DayInput.rtGroups`, with the sets
 * started each hour in `HourInput.rtGroupSets`), every group in the hour is evaluated on its own — its load, RIR, rest,
 * contraction type (f_type exactly once; holds bypass f_RIR/f_load), failure flag and its bout's cold-water immersion —
 * with the run's drawn constants, and only then summed per region. Raw physical sets (neural practice, f_loadS weighting)
 * stay separate from region-weighted and effective sets. Days without groups keep the legacy per-hour path (one merged
 * RIR/load per hour, rest/CWI of the first resistance session covering the hour) — the fallback for hand-built schedules
 * and stored legacy doses, never invented detail.
 */
import { defineModule } from '../../core/moduleKit';
import { DEFAULTS as DEFAULTS_ } from '../../core/defaults';
import { MAX_MEALS as MAX_MEALS_, N_REGIONS as N_REGIONS_ } from '../../types/inputs';
import type { DayInput, HourInput, ResistanceGroupResolved, SessionResolved } from '../../types/inputs';
import type { CausalResolution, HistoryAssumptionKind } from '@/lib/bodyContracts';
import type { ResolvedProfile, TrainingGrowthState } from '../../types/profile';
import type { ModelParams } from '../../types/params';
import { param } from '../../core/paramsRegistry';
import { MI as MI_, type SeriesId } from '../../types/metrics';
import type { SeriesStatusMeta } from '../../types/result';
import type { ModuleId, SignalName } from '../../types/signals';
import type { EngineModule, SignalHookDecl, StepClock } from '../../types/module';
import { trainingFfmiOffset } from '../../body/estimateBody';
import { MUSCLE_PARAMS } from './params';
import { readMuscleConstants, type MuscleConstants } from './constants';
import * as eq from './equations';
import type { Ts0Result } from './equations';

// Imported bindings copied once into module-local constants. Under a dev-server/Vitest SSR transform every imported
// binding becomes a namespace getter call, which doubled this module's cost; in a bundled build this is free.
const N_REGIONS = N_REGIONS_;
const MAX_MEALS = MAX_MEALS_;
const MI_MPS = MI_.mps;
const MI_STRENGTH = MI_.strength;
const MI_TS = MI_.trainingStatus;
const MI_RTGAIN = MI_.rtMuscleGain;
const RT_REST_DEFAULT = DEFAULTS_.rtRestSec;
const RT_LOAD_DEFAULT = DEFAULTS_.rtLoadPct1RM;
const RT_RIR_DEFAULT = DEFAULTS_.rtRir;
const boutStimulus = eq.boutStimulus;
const groupSetFactor = eq.groupSetFactor;
const clamp = eq.clamp;
const detrainFloor = eq.detrainFloor;
const detrainLambda = eq.detrainLambda;
const detrainLoss = eq.detrainLoss;
const distributionEfficiency = eq.distributionEfficiency;
const fAge = eq.fAge;
const fAlcohol = eq.fAlcohol;
const fCreatine = eq.fCreatine;
const fEnergyMps = eq.fEnergyMps;
const fEnergyProtein = eq.fEnergyProtein;
const feedingStimulus = eq.feedingStimulus;
const fFreq = eq.fFreq;
const fFreqStrength = eq.fFreqStrength;
const fLoad = eq.fLoad;
const fLoadStrength = eq.fLoadStrength;
const fProtein = eq.fProtein;
const fRest = eq.fRest;
const fRir = eq.fRir;
const fVolume = eq.fVolume;
const hStrength = eq.hStrength;
const initialTrainingStatus = eq.initialTrainingStatus;
const kAgeMps = eq.kAgeMps;
const kernelAmp = eq.kernelAmp;
const kernelTau = eq.kernelTau;
const leanness = eq.leanness;
const nMax = eq.nMax;
const obesityRamp = eq.obesityRamp;
const proteinAdequacy = eq.proteinAdequacy;
const refractoryStep = eq.refractoryStep;
const trainedGains0 = eq.trainedGains0;
const vMaintenance = eq.vMaintenance;
const vRetention = eq.vRetention;

const RING = 7;

/**
 * Native temporal resolution of the muscle module's own inputs (D2-01, C2), per output. `startDay` reads whole-day totals
 * of the day being stepped — protein and its quality (f_P, x_P), the meal distribution (E_dist) and the day's steps
 * (anabolic resistance) — so everything they reach is daily-native: valid at a completed day boundary, its within-day
 * values are not causally validated current physiology. The hourly kernel S_mps (`mpsStimWb`) reads only sets performed up
 * to the hour and slow states latched at earlier day ends. Planned fast metadata (`fastPolicy`, fast spans, `plannedFast`)
 * is never read. Upstream signals combine with these through `weakestResolution`; no elapsed-day totals are substituted
 * into the full-day coefficients. Same declaration shape as composition/energy/water (`*_CAUSAL_RESOLUTION`); declarative
 * only, nothing here changes physiology.
 */
export const MUSCLE_CAUSAL_RESOLUTION = {
  module: 'muscle',
  nativeResolution: 'daily',
  dailyInputs: ['proteinG', 'proteinQDaily', 'meals', 'nMeals', 'steps'],
  dayStartSignals: ['ageYears', 'ffmActKg', 'tissueMassKg', 'mpsSleepMult', 'energyBalanceFrac'],
  planMetadataReads: [],
  series: ['mps', 'strength', 'trainingStatus', 'rtMuscleGain'],
  signals: ['rtAccretionKgD', 'rtRetentionFrac', 'rtDoseFrac', 'smRtKg', 'rtVolumeWb', 'trainingStatus'],
  /** Written from sets performed up to the hour and states latched at earlier day ends only (own inputs). */
  eventPrefixSignals: ['mpsStimWb'],
  assumption: 'dailyNativeModel',
  reasonCode: 'dailyNativeMuscleDayTotals',
} as const satisfies {
  module: ModuleId;
  nativeResolution: CausalResolution;
  dailyInputs: readonly (keyof DayInput)[];
  dayStartSignals: readonly SignalName[];
  planMetadataReads: readonly (keyof DayInput)[];
  series: readonly SeriesId[];
  signals: readonly SignalName[];
  eventPrefixSignals: readonly SignalName[];
  assumption: HistoryAssumptionKind;
  reasonCode: string;
};
export const MUSCLE_DAILY_NATIVE_READS: readonly string[] = MUSCLE_CAUSAL_RESOLUTION.dailyInputs.map((k) => `DayInput.${k}`);
export const MUSCLE_OUTPUT_RESOLUTION: Readonly<Record<string, CausalResolution>> = (() => {
  const out: Record<string, CausalResolution> = {};
  for (const id of MUSCLE_CAUSAL_RESOLUTION.eventPrefixSignals) out[id] = 'eventPrefix';
  for (const id of [...MUSCLE_CAUSAL_RESOLUTION.series, ...MUSCLE_CAUSAL_RESOLUTION.signals]) out[id] = MUSCLE_CAUSAL_RESOLUTION.nativeResolution;
  return out;
})();

/**
 * Physical-bout slots (A1-020): slot 0 is the legacy merged-hour path (days without compiled set groups; its bout still ends
 * after a set-free hour, bit-identical to the pre-group engine), slots 1 … BOUT_SLOTS − 1 hold the true bouts of the
 * set-group path, keyed by their stable identity. The per-bout nonlinear terms (f_fastHV's raw-set count, the kernel
 * saturation a(s) and its ramp, the 03 bout stimulus) are evaluated per slot, never on all the work of a clock hour.
 */
export const BOUT_SLOTS = 8;
const LEGACY_SLOT = 0;

/**
 * Per-hour scratch (slot-major, BOUT_SLOTS × N_REGIONS): region-weighted raw sets, their effective-set multiplier
 * (raw-weighted mean of the bout's groups' own factors), the share of effective sets followed by cold-water immersion and
 * the failure flag; `H_SLOT` lists the slots that received sets this hour. Written and consumed inside one `stepHour` call
 * (never carried across calls, so no snapshot state).
 */
const H_RAW = new Float64Array(BOUT_SLOTS * N_REGIONS);
const H_MULT = new Float64Array(BOUT_SLOTS * N_REGIONS);
const H_CWI = new Float64Array(BOUT_SLOTS * N_REGIONS);
const H_FAIL = new Float64Array(BOUT_SLOTS * N_REGIONS);
const H_SLOT = new Int32Array(BOUT_SLOTS);
/** Kernel scratch: this hour's ramp values per region (summed over the slots still in their ramp phase). */
const RAMP_V = new Float64Array(N_REGIONS);

/**
 * Scenario switches of the muscle module (D3-04, D3-05), read in `prepare` from the registry: the meal-distribution mode
 * (0 neutral production, 1 legacy research curve) and the growth scenario used when the growth state is unknown (0 stable
 * burn-in anchor, 1 progress). Absent (constants read without `prepare`) = the production values.
 */
export interface MuscleScenarioK {
  eDistMode: number;
  growthScenarioUnknown: number;
}

/** Constants of one run (parameters, precomputed factors, the event sink — kept out of the cloneable state). */
export type MuscleK = MuscleConstants & { scenario?: MuscleScenarioK };

/** Read the scenario switches (D3-04, D3-05) of a parameter vector. */
export function readMuscleScenario(p: ModelParams): MuscleScenarioK {
  return { eDistMode: param(p, 'muscle.eDistMode'), growthScenarioUnknown: param(p, 'muscle.growthScenarioUnknown') };
}

/** Growth scenarios (D3-05): 'stable' = accretion above the habitual burn-in reference; 'progress' = the gross rate. */
export type GrowthScenario = 'stable' | 'progress';
const GROWTH_STATE_CODE: Readonly<Record<TrainingGrowthState, number>> = { unknown: 0, progressing: 1, plateaued: 2, resuming: 3 };
const GROWTH_STATES: readonly TrainingGrowthState[] = ['unknown', 'progressing', 'plateaued', 'resuming'];

/** The training growth state, its source, the scenario it selects and the assumption to report (D3-05). */
export interface GrowthScenarioInfo {
  state: TrainingGrowthState;
  source: 'user' | 'observedTrend' | 'unknown';
  scenario: GrowthScenario;
  /** True when the habitual week has RT (otherwise B_ref = 0 and both scenarios coincide). */
  habitualRt: boolean;
  /** Named assumption: the stable numerical anchor for an unknown state, or the selected declared/alternative scenario. */
  assumption: 'growthBurnInAnchor' | 'growthPlateauReference' | 'growthProgressScenario';
}

/**
 * D3-05: growth state → scenario. Unknown (the default, and every legacy "currently training" profile) keeps the stable
 * burn-in anchor unless `growthScenarioUnknown` selects progress; 'plateaued' uses the reference; 'progressing' and
 * 'resuming' use the progress scenario. Never a mixture probability.
 */
export function growthScenarioFor(k: MuscleK, prof: ResolvedProfile): GrowthScenarioInfo {
  const h = prof.input.habits;
  const raw = h?.trainingGrowthState;
  const state: TrainingGrowthState = raw !== undefined && GROWTH_STATES.includes(raw) ? raw : 'unknown';
  const src = h?.trainingGrowthStateSource;
  const source = state === 'unknown' ? 'unknown' : src === 'user' || src === 'observedTrend' ? src : 'unknown';
  const hab = prof.habits;
  const habitualRt = habitualRtSessions(hab.sessionsPerWeek, hab.lifingCardioMix) > 0;
  let scenario: GrowthScenario;
  if (state === 'plateaued') scenario = 'stable';
  else if (state === 'progressing' || state === 'resuming') scenario = 'progress';
  else scenario = (k.scenario?.growthScenarioUnknown ?? 0) >= 0.5 ? 'progress' : 'stable';
  const assumption = scenario === 'progress' ? 'growthProgressScenario' : state === 'plateaued' ? 'growthPlateauReference' : 'growthBurnInAnchor';
  return { state, source, scenario, habitualRt, assumption };
}

/**
 * Named assumptions the muscle module brings into a run (C6, for `SimulationMeta.assumptions`): neutral meal distribution,
 * the exploratory MPS index, the legacy detraining kinetics as scenarios, and the growth scenario of the profile.
 */
export const MUSCLE_MODEL_ASSUMPTIONS = ['mealDistributionNeutral', 'mpsExploratoryIndex', 'detrainingKineticsScenario'] as const;

/** Named growth assumption of a run's muscle state (D3-05), from the codes carried in the state. */
export function growthAssumptionOf(s: Pick<MuscleState, 'growthState' | 'growthScenario'>): GrowthScenarioInfo['assumption'] {
  if (s.growthScenario === 1) return 'growthProgressScenario';
  return s.growthState === GROWTH_STATE_CODE.plateaued ? 'growthPlateauReference' : 'growthBurnInAnchor';
}

/**
 * A1-022: named assumption of a run whose resistance dose includes sets with an UNKNOWN hard-set count — a minutes-only
 * record kept as the labelled legacy minute-conversion scenario (`unknownDoseScenario: 'legacyMinuteConversion'`), never an
 * observed dose or a biological zero. Energy outputs do not depend on it.
 */
export const MUSCLE_UNKNOWN_DOSE_ASSUMPTION = 'unknownHardSetCount' as const;
/** Reason code of the outputs conditioned by an unknown hard-set count (A1-022). */
export const MUSCLE_UNKNOWN_DOSE_REASON = 'unknownHardSetCount' as const;
/** Muscle series whose values follow the hard-set dose (growth, training status, strength); exercise energy never does. */
export const MUSCLE_DOSE_DEPENDENT_SERIES = ['rtMuscleGain', 'trainingStatus', 'strength'] as const satisfies readonly SeriesId[];

/** A1-022: the first plan day (≥ 0) from which the run's muscle outputs rest on an unknown hard-set count, or null. */
export function muscleUnknownDoseFromDay(s: Pick<MuscleState, 'unknownDoseFromDay'>): number | null {
  return Number.isFinite(s.unknownDoseFromDay) && s.unknownDoseFromDay >= 0 ? s.unknownDoseFromDay : null;
}

/**
 * Named assumptions of a run's muscle state (C6/A1-022): the growth scenario (D3-05) and, when sets of an unknown hard-set
 * count were stepped, `unknownHardSetCount` (the id the core loop's input-dependency statuses use). Allocation allowed (finalize).
 */
export function muscleRunAssumptions(s: Pick<MuscleState, 'growthState' | 'growthScenario' | 'unknownDoseFromDay'>): string[] {
  const out: string[] = [growthAssumptionOf(s)];
  if (muscleUnknownDoseFromDay(s) !== null) out.push(MUSCLE_UNKNOWN_DOSE_ASSUMPTION);
  return out;
}

/**
 * C6 statuses of the muscle module's outputs (D3-04, D3-05, D3-06, A1-022), for the run's recorder: the MPS series is an
 * exploratory simulated anabolic-response index (never measured fractional synthesis, never tissue gain); training-
 * attributable lean and the strength index are scenarios — lean labelled by the growth scenario of the profile (the stable
 * burn-in anchor, a stated plateau reference or the progress scenario), detraining by the legacy kinetics as a scenario.
 * When sets of an unknown hard-set count were stepped (A1-022), lean gain and strength are conditional on that named
 * scenario (reason `unknownHardSetCount`; they are scenarios for the whole run already) and the training status is a scenario
 * from that day; the dependants close through the output dependency graph. Allocation allowed (finalize).
 */
export function muscleOutputStatus(s: Pick<MuscleState, 'growthState' | 'growthScenario'> & Partial<Pick<MuscleState, 'unknownDoseFromDay'>>): Partial<Record<SeriesId, SeriesStatusMeta>> {
  const from = s.unknownDoseFromDay !== undefined ? muscleUnknownDoseFromDay({ unknownDoseFromDay: s.unknownDoseFromDay }) : null;
  const out: Partial<Record<SeriesId, SeriesStatusMeta>> = {
    mps: { status: 'exploratory', reasonCode: 'simulatedResponseIndex', uncertaintyKind: 'heuristic' },
    rtMuscleGain: { status: 'scenario', reasonCode: from !== null ? MUSCLE_UNKNOWN_DOSE_REASON : growthAssumptionOf(s), uncertaintyKind: 'scenario' },
    strength: { status: 'scenario', reasonCode: from !== null ? MUSCLE_UNKNOWN_DOSE_REASON : 'taskSpecificIndex', uncertaintyKind: 'scenario' },
  };
  if (from !== null) out.trainingStatus = { status: 'scenario', reasonCode: MUSCLE_UNKNOWN_DOSE_REASON, uncertaintyKind: 'scenario', fromDay: from };
  return out;
}

export interface MuscleState {
  // ---------------------------------------------------------------- person (set at init)
  /** Height, m; 1 when the profile is female (03 leanness index), else 0. */
  heightM: number;
  female: number;
  /** 1 when the habitual week contains resistance sessions (09 §2 initial-value rules: H₀ = 1, N₀ > 0, T_low,0 = 0). */
  currentlyTraining: number;
  /** D3-05 training growth state (0 unknown, 1 progressing, 2 plateaued, 3 resuming) and the scenario it selected (0 stable
   *  burn-in reference, 1 progress) — carried in the state so snapshots and replans keep them. */
  growthState: number;
  growthScenario: number;

  // ---------------------------------------------------------------- 09 §4.1 sets and 7-day window
  /** Effective sets per region per day, ring of 7 days (index r·7 + slot), sets. */
  setsHist: Float64Array;
  /** Next ring slot (0..6). */
  histIdx: number;
  /** Effective sets accumulated today per region, sets. */
  todaySets: Float64Array;
  /** V_r: 7-day effective sets, sets/wk; F_r: training days per region in the last 7 days, d/wk. */
  vR: Float64Array;
  fR: Float64Array;
  /**
   * A1-020 physical-bout slots (BOUT_SLOTS; slot 0 = the legacy merged-hour path): stable bout key ('' = none / legacy),
   * numeric fallback identity of identity-less schedules (absolute origin day, origin session index, −1 = unknown), the
   * absolute hour (day·24 + clock h) the bout's compiled interval ends, 1 while the bout is open; and per slot × region
   * (index b·N_REGIONS + r) the bout's effective and raw (entered) sets so far. A bout ends by its compiled interval and
   * identity (never by an empty clock hour); its kernel ramp outlives it.
   */
  boutKey: string[];
  boutOrigin: Float64Array;
  boutSess: Float64Array;
  boutEnd: Float64Array;
  boutOpen: Float64Array;
  boutEff: Float64Array;
  boutRaw: Float64Array;
  /** 1 while the previous hour contained legacy-path (merged-hour) resistance sets: the legacy slot's bout is open. */
  legacyIn: number;
  /**
   * A1-022: first plan day (≥ 0; −1 = none) on which sets with an UNKNOWN hard-set count (a minutes-only record's named
   * legacy minute-conversion scenario) were stepped, and whether today has any. Growth, retention and strength from that
   * day are conditional on the scenario (`muscleOutputStatus`); energy outputs are untouched.
   */
  unknownDoseFromDay: number;
  unknownDoseToday: number;
  /** 1 on regions that had a set to failure today; 1 when the region's last session had failure sets. */
  failToday: Float64Array;
  lastFail: Float64Array;
  /** Days since the region last had an effective set (burn-in included; 1e6 = never), d. */
  daysSinceTrained: Float64Array;
  /** 21 §4D-4: effective sets of CWI-followed sessions × (1 − f_CWI) per region, ring of 7 days (r·7 + slot), today's
   *  accumulator per region, and the ring's daily totals (to skip the per-region sums when no CWI is in the window). */
  cwiLossHist: Float64Array;
  cwiLossToday: Float64Array;
  cwiDayTot: Float64Array;

  // ---------------------------------------------------------------- 09 §4.5-4.10 slow states per region
  /** Habituation H_r, 0..1. */
  hR: Float64Array;
  /** Oedema/swelling W_r, fraction of regional muscle volume. */
  wR: Float64Array;
  /** Training-attributable lean M_acc,r (FFM-equivalent), kg; its t = 0 value; its peak (memory), kg. */
  mAcc: Float64Array;
  mAcc0: Float64Array;
  mPeak: Float64Array;
  /** Non-detrainable set-point share of M_acc,r (all of M_acc,0 without habitual RT; with it, M_acc,0 minus the trained
   *  gains the body carries above its untrained FFMI-derived set-point — R-DETRAIN), kg. */
  mBase: Float64Array;
  /** Floor detraining decays towards (D3-06): the set-point plus `detrainFloorFrac` (0 centrally) of the attained trained
   *  gains above it (M_peak − set-point, history-based, never the run origin), kg. */
  mFloor: Float64Array;
  /** Habitual reference gross accretion rate B_ref,r (the habitual week at maintenance, latched in endBurnIn; 0 without
   *  habitual RT or under the progress growth scenario, D3-05), kg/d; this day's CWI factor f_CWI,r of the 7-day window. */
  bRef: Float64Array;
  cwiF: Float64Array;
  /** Genetic trainable potential G_pot,r, kg. */
  gPot: Float64Array;
  /** T_low,r: consecutive days with V_r < V_maint, d. */
  tLow: Float64Array;
  /** Neuromuscular fatigue Fat_r (09 §4.11), fraction. */
  fatR: Float64Array;

  // ---------------------------------------------------------------- 09 §4.14 strength
  /** Neural component N and its t = 0 value (strength index denominator is 1 + N0). */
  nNeural: number;
  strength0: number;
  /** Habitual-week means of (1 − Fat_acute) and of M_EA (strength index references, latched in endBurnIn), their
   *  burn-in rings (7 days) and fill count; 1 while the next recordDay is the t = 0 capture (index = 100 by definition). */
  fatRef: number;
  eaRef: number;
  fatRing: Float64Array;
  eaRing: Float64Array;
  baseCount: number;
  t0Rec: number;
  /** Skeletal muscle at t = 0 (latched at the end of burn-in), kg. */
  m0: number;
  /** Ring of daily raw RT sets and of sets·f_loadS (set-weighted strength load factor). */
  setsTotHist: Float64Array;
  loadSHist: Float64Array;
  todaySetsTot: number;
  todayLoadSW: number;

  // ---------------------------------------------------------------- 09 §4.4 kernel (per bout slot × region) and 03 X_RT
  /**
   * Per slot × region (b·N_REGIONS + r, A1-020: one pulse per true bout and region): the bout's ramping amplitude
   * A(H)·a(s), its age in whole hours since start (−1 = not in the ramp phase) and the amplitude already handed to the
   * residual (long bouts); `rampOn` = 1 while a slot has any region in its ramp phase.
   */
  kAmpB: Float64Array;
  kAgeB: Float64Array;
  kCommitB: Float64Array;
  rampOn: Float64Array;
  /** Sum of earlier bouts in their exponential phase (value at the current hour midpoint), per region. */
  kResid: Float64Array;
  /** exp(−1/τ(H_r)) per hour, refreshed daily; the H_r it was computed for. */
  kDecay: Float64Array;
  kDecayH: Float64Array;
  /** Cache of f_V(V_r): the V_r it was computed for (−1 = empty) and the value (V_r is constant under a weekly pattern). */
  fvV: Float64Array;
  fvF: Float64Array;
  /** S_mps,r this hour, fraction above basal. */
  sMps: Float64Array;
  kernelActive: number;
  /** 03 X_RT double-exponential sums (slow τ_X, fast τ_on) of bout stimuli I_b, and X_RT itself. */
  xSlow: number;
  xFast: number;
  xRT: number;
  xActive: number;
  /** exp(−1/τ_X) and exp(−0.5/τ_X), τ_X by whole-body habituation (36 h → 12 h). */
  xDecay: number;
  xHalf: number;

  // ---------------------------------------------------------------- 03 §4.7 hourly MPS display layer
  /** Muscle-full refractoriness R, 0..1. */
  refractoryR: number;
  /** MPS index = 100·MPS/s0 this hour, % of basal. */
  mpsIdx: number;
  /** AI_day: today's integral of feeding-stimulated MPS, %·d⁻¹ (diagnostic). */
  aiDay: number;
  /** K_age for today, g/kg FFM/h. */
  kAgeMpsVal: number;
  /** Today's FFM (kg) and sleep multiplier (bus values cached at startDay: bus reads are the costly ones). */
  ffmDay: number;
  sleepMult: number;
  /** f_E,MPS (relaxed, τ 2 d); AR_fed step component (relaxed); AR_fed total; b_X obesity multiplier. */
  fEMps: number;
  arSteps: number;
  arFed: number;
  bxMult: number;

  // ---------------------------------------------------------------- protein, energy and distribution
  /** 7-day ring of daily quality-weighted protein per kg body mass, g/kg/d (effective P of f_P, R-RT revised; 03 §4.2
   *  7-day integration, 03 §4.10 quality). */
  qRing: Float64Array;
  qIdx: number;
  /** Today's quality-weighted protein per kg body mass, g/kg/d (7-day mean → f_P and 09 ρ(P)). */
  qToday: number;
  /** Distribution efficiency applied today: 1 in production (D3-04), the legacy 03 §4.8 curve under `eDistMode` 1. */
  eDist: number;
  /** Scratch arrays for today's meals (clock h, Q_meal-weighted protein g, protein g). */
  mealT: Float64Array;
  mealQ: Float64Array;
  mealP: Float64Array;

  // ---------------------------------------------------------------- 15 §4.10 alcohol after training
  /** Ethanol pool at the end of the last training hour, g; alcohol dose counted today, g. */
  poolAtRt: number;
  alcDoseG: number;
  /** Protein eaten in the first 2 h after the session, g. */
  protWinG: number;
  /** Hours left in the 8-h alcohol window and the 2-h protein window. */
  winLeft: number;
  protLeft: number;
  /** 1 when the session-end pool still has to be added to the dose. */
  alcPending: number;
  /** 1 when a post-session window was open today; 1 when resistance sets occurred today. */
  winTouched: number;
  trainedToday: number;
  /** 7-day ring of energyBalanceFrac: 09 f_EP uses its mean e₇ (study-average balance; daily u swings ±0.1 between
   *  training and rest days because TEE_est includes the day's session). */
  eRing: Float64Array;
  /** 7-day ring of the day-specific accretion factors mpsSleepMult·f_alc·f_Cr·E_dist (their mean enters B_r; the day's
   *  value scales the day's share of the excess). */
  dRing: Float64Array;

  // ---------------------------------------------------------------- whole-body outputs
  /** Whole-body TS, mass-weighted V_wb (sets/wk), F_wb (d/wk), H_wb, CWI factor of V_wb, acute fatigue, strength index
   *  (% of baseline). */
  ts: number;
  vWb: number;
  fWb: number;
  hWb: number;
  cwiWb: number;
  fatAcute: number;
  strength: number;
  /** Σ M_acc,r at t = 0, kg. */
  mAcc0Sum: number;
  /** Today's Σ A_r and Σ D_r, kg/d. */
  accToday: number;
  detToday: number;
  /** 1 while the detrainingOnset event has fired and λ of the reference region stays > 0. */
  detrainFlag: number;
}

/**
 * Index of the resistance session covering this clock hour, −1 when none matches. Legacy fallback only (days without
 * compiled set groups): the group path reads each group's own session instead.
 */
function rtSessionAt(day: DayInput, hourOfDay: number): number {
  for (let i = 0; i < day.nSessions; i++) {
    const se = day.sessions[i]!;
    if (se.kind !== 'resistance') continue;
    const end = se.startH + se.durationMin / 60;
    if (hourOfDay + 1 > se.startH && hourOfDay < end) return i;
  }
  return -1;
}

/** Hour totals of `hourSets`: physical (raw) sets, Σ sets·f_loadS, and the number of slots in `H_SLOT`. */
const HT = { phys: 0, loadSW: 0, nSlots: 0, unknownDose: 0 };

const finiteNum = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);

/** True when a group's set count is unknown (a minutes-only record's named scenario, A1-022). */
function groupSetsUnknown(grp: ResistanceGroupResolved, own: SessionResolved | null): boolean {
  return (grp.setsUnknown ?? 0) > 0 || grp.provenance?.sets === 'unknown' || (own !== null && own.doseStatus === 'unknown');
}

/**
 * The stable identity of a group's bout (A1-020): the compiler's `boutKey`, else the bout's `sessionId` (own session or the
 * carried copy's), else '' (identity-less legacy schedule: the numeric origin day + session index identify it).
 */
function groupBoutKey(grp: ResistanceGroupResolved, own: SessionResolved | null): string {
  const k = grp.boutKey;
  if (k !== undefined && k !== '') return k;
  const sid = grp.sessionId;
  if (sid !== undefined && sid !== '') return sid;
  if (own !== null) {
    const ok = own.boutKey;
    if (ok !== undefined && ok !== '') return ok;
    const osid = own.sessionId;
    if (osid !== undefined && osid !== '') return osid;
  }
  return '';
}

/**
 * Clock hour (today's clock, may exceed 24) at which the compiled interval of `grp`'s bout ends (A1-020): the latest of the
 * group's own end, the compiler's `boutEndH`, the owning session's interval and its groups (own bout), or every carried
 * copy of the same bout listed today (a bout continued past midnight). Scans the day's groups once per new bout.
 */
function boutEndClock(day: DayInput, grp: ResistanceGroupResolved, key: string, own: SessionResolved | null, nGroups: number): number {
  let end = grp.startH + (grp.durationMin > 0 ? grp.durationMin : 0) / 60;
  const carried = grp.session < 0;
  const be = grp.boutEndH;
  // a carried copy's boutEndH may be stated on its origin day's clock (> 24) or on today's
  if (finiteNum(be)) end = Math.max(end, carried && be > 24 ? be - 24 : be);
  const groups = day.rtGroups!;
  if (own !== null) {
    end = Math.max(end, own.startH + own.durationMin / 60);
    if (finiteNum(own.boutEndH)) end = Math.max(end, own.boutEndH);
    const g0 = own.groupStart ?? 0;
    const g1 = Math.min(nGroups, g0 + (own.groupCount ?? 0));
    for (let g = g0; g < g1; g++) {
      const o = groups[g]!;
      end = Math.max(end, o.startH + (o.durationMin > 0 ? o.durationMin : 0) / 60);
    }
  } else if (carried) {
    for (let g = 0; g < nGroups; g++) {
      const o = groups[g]!;
      if (o.session >= 0 || groupBoutKey(o, null) !== key) continue;
      if (key === '' && o.originDay !== grp.originDay) continue;
      end = Math.max(end, o.startH + (o.durationMin > 0 ? o.durationMin : 0) / 60);
    }
  }
  return end;
}

/** Zero the per-bout accumulators of slot `b` (the kernel ramp is left alone: it outlives the bout). */
function clearBout(s: MuscleState, b: number): void {
  s.boutKey[b] = '';
  s.boutOrigin[b] = -1e9;
  s.boutSess[b] = -1;
  s.boutEnd[b] = -1e9;
  s.boutOpen[b] = 0;
  const base = b * N_REGIONS;
  for (let r = 0; r < N_REGIONS; r++) {
    s.boutEff[base + r] = 0;
    s.boutRaw[base + r] = 0;
  }
}

/**
 * The open slot of a group-path bout (A1-020): the same key, or, identity-less, the same origin day and session (a carried
 * identity-less copy joins its origin day's open identity-less bout); −1 when the bout is not open.
 */
function findBout(s: MuscleState, key: string, originAbs: number, sess: number): number {
  for (let b = 1; b < BOUT_SLOTS; b++) {
    if (s.boutOpen[b] === 0) continue;
    if (key !== '') {
      if (s.boutKey[b] === key) return b;
    } else if (s.boutKey[b] === '' && s.boutOrigin[b] === originAbs && (sess < 0 || s.boutSess[b] === sess)) return b;
  }
  return -1;
}

/**
 * Open a slot for a new group-path bout (A1-020): a free one, else one whose bout has ended (its ramps continue; a region it
 * touches again freezes its own ramp into the residual, the pre-existing approximation), else, beyond BOUT_SLOTS − 1
 * simultaneously open bouts, the one that ends first (merged: never reached with MAX_SESSIONS sessions per day).
 */
function openBout(s: MuscleState, key: string, originAbs: number, sess: number, endAbs: number): number {
  let pick = -1;
  for (let b = 1; b < BOUT_SLOTS && pick < 0; b++) if (s.boutOpen[b] === 0 && s.rampOn[b] === 0) pick = b;
  for (let b = 1; b < BOUT_SLOTS && pick < 0; b++) if (s.boutOpen[b] === 0) pick = b;
  if (pick < 0) {
    pick = 1;
    for (let b = 2; b < BOUT_SLOTS; b++) if (s.boutEnd[b]! < s.boutEnd[pick]!) pick = b;
  }
  clearBout(s, pick);
  s.boutKey[pick] = key;
  s.boutOrigin[pick] = originAbs;
  s.boutSess[pick] = sess;
  s.boutEnd[pick] = endAbs;
  s.boutOpen[pick] = 1;
  return pick;
}

/** Add slot `b` to this hour's slot list (zeroing its scratch on first use). */
function touchSlot(b: number): void {
  for (let j = 0; j < HT.nSlots; j++) if (H_SLOT[j] === b) return;
  H_SLOT[HT.nSlots++] = b;
  const base = b * N_REGIONS;
  for (let r = 0; r < N_REGIONS; r++) {
    H_RAW[base + r] = 0;
    H_MULT[base + r] = 0;
    H_CWI[base + r] = 0;
    H_FAIL[base + r] = 0;
  }
}

/**
 * Fill the per-hour scratch (H_RAW, H_MULT, H_CWI, H_FAIL per bout slot, H_SLOT, HT) with this hour's resistance sets;
 * false when there are none.
 *
 * Group path (D3-01, the day has compiled set groups and the hour carries `rtGroupSets`): each group started in the hour is
 * evaluated with its own load/RIR/rest/contraction (drawn factors, f_type once), its own bout's failure flag and CWI, then
 * summed per region INSIDE ITS PHYSICAL BOUT (A1-020: the bout's slot, by stable identity — `boutKey`, else `sessionId`,
 * else origin day + session index — and its compiled interval). Bouts whose interval ended before this hour are closed
 * first; a gap inside one bout keeps it open, two bouts in one hour stay two. Unknown (NaN) load/RIR/rest take the engine
 * defaults (an assumption the compiler flags as `assumed`). The legacy hour arrays (`rtSetsByRegion`, `rtSetsTotal`) are
 * ignored on such a day, so nothing is counted twice; the compiler then lists every set stepped in the day's hours,
 * including a bout carried past midnight (its `session` is −1 when the owning session is not in this day's `sessions`).
 *
 * Legacy path (no groups): the merged hour arrays with the hour's single RIR/load and the first covering session's rest/CWI,
 * all in the legacy slot (bit-identical to the pre-group engine).
 */
function hourSets(s: MuscleState, k: MuscleK, hour: HourInput, day: DayInput, clock: StepClock): boolean {
  const n = N_REGIONS;
  HT.nSlots = 0;
  HT.unknownDose = 0;
  const dayAbs = clock.day * 24;
  const hourAbs = dayAbs + hour.hourOfDay;
  // A1-020: bouts whose compiled interval ended by the start of this hour are over (never an empty-hour rule)
  for (let b = 1; b < BOUT_SLOTS; b++) if (s.boutOpen[b] !== 0 && hourAbs >= s.boutEnd[b]! - 1e-9) clearBout(s, b);
  const groups = day.rtGroups;
  const gSets = hour.rtGroupSets;
  const nGroups = groups !== undefined && gSets !== undefined ? (day.nRtGroups ?? 0) : 0;
  if (nGroups > 0) {
    const ng = Math.min(nGroups, groups!.length, gSets!.length);
    let phys = 0;
    let loadSW = 0;
    for (let g = 0; g < ng; g++) {
      const sets = gSets![g]!;
      if (!(sets > 0)) continue;
      const grp = groups![g]!;
      const si = grp.session;
      const se = si >= 0 && si < day.nSessions ? day.sessions[si]! : null;
      const own = se !== null && se.kind === 'resistance' ? se : null;
      // the physical bout of the group: its slot by identity and compiled interval (A1-020)
      const key = groupBoutKey(grp, own);
      const originAbs = clock.day - (finiteNum(grp.originDay) ? day.day - grp.originDay : si >= 0 ? 0 : 1);
      let b = findBout(s, key, originAbs, si);
      if (b < 0) b = openBout(s, key, originAbs, si, dayAbs + boutEndClock(day, grp, key, own, ng));
      else {
        // an open bout never ends before the groups it actually steps
        const gEnd = dayAbs + grp.startH + (grp.durationMin > 0 ? grp.durationMin : 0) / 60;
        if (gEnd > s.boutEnd[b]!) s.boutEnd[b] = gEnd;
      }
      touchSlot(b);
      const base = b * n;
      // a copy carried past midnight (session −1) keeps its bout's flags on the group (D3-01)
      const fail = grp.toFailure ?? (own !== null && own.toFailure);
      const load = grp.loadPct1RM > 0 ? grp.loadPct1RM : RT_LOAD_DEFAULT;
      const rir = fail ? 0 : Number.isFinite(grp.rir) ? grp.rir : RT_RIR_DEFAULT;
      const rest = grp.restSec >= 0 ? grp.restSec : RT_REST_DEFAULT;
      const mult = groupSetFactor(k, grp.contraction, grp.typeFactorIncluded, load, rir, rest);
      // 21 §4D-4: a group of a bout followed by cold-water immersion keeps only f_CWI of its stimulus
      const cwiLoss = (grp.coldWaterImmersion ?? (own !== null && own.coldWaterImmersion === true)) ? 1 - k.fCwi : 0;
      const w = grp.regionWeights;
      for (let r = 0; r < n; r++) {
        const wr = w[r]!;
        if (!(wr > 0)) continue;
        const raw = sets * wr;
        const eff = raw * mult;
        H_RAW[base + r] = H_RAW[base + r]! + raw;
        H_MULT[base + r] = H_MULT[base + r]! + eff; // Σ effective sets for now; divided by raw below
        if (cwiLoss > 0) H_CWI[base + r] = H_CWI[base + r]! + eff * cwiLoss;
        if (fail) H_FAIL[base + r] = 1;
      }
      phys += sets;
      loadSW += sets * fLoadStrength(k, load);
      if (groupSetsUnknown(grp, own)) HT.unknownDose = 1;
    }
    if (HT.nSlots === 0) return false;
    for (let j = 0; j < HT.nSlots; j++) {
      const base = H_SLOT[j]! * n;
      for (let r = 0; r < n; r++) {
        const raw = H_RAW[base + r]!;
        const eff = H_MULT[base + r]!;
        H_MULT[base + r] = raw > 0 ? eff / raw : 0;
        H_CWI[base + r] = eff > 0 ? H_CWI[base + r]! / eff : 0;
      }
    }
    HT.phys = phys;
    HT.loadSW = loadSW;
    return true;
  }

  const setsTot = hour.rtSetsTotal;
  if (!(setsTot > 0)) return false;
  const load = hour.rtLoadPct1RM > 0 ? hour.rtLoadPct1RM : RT_LOAD_DEFAULT;
  const rir = hour.rtToFailure > 0 ? 0 : hour.rtRir;
  const si = rtSessionAt(day, hour.hourOfDay);
  const sess = si >= 0 ? day.sessions[si]! : null;
  const mult = fRir(k, rir, load) * fLoad(k, load) * fRest(k, sess ? sess.restSec : RT_REST_DEFAULT) * k.fConc;
  // 21 §4D-4: sets of a session followed by cold-water immersion keep only f_CWI of their stimulus
  const cwiLoss = sess && sess.coldWaterImmersion === true ? 1 - k.fCwi : 0;
  const fail = hour.rtToFailure > 0 ? 1 : 0;
  H_SLOT[0] = LEGACY_SLOT;
  HT.nSlots = 1;
  for (let r = 0; r < n; r++) {
    H_RAW[r] = hour.rtSetsByRegion[r]!;
    H_MULT[r] = mult;
    H_CWI[r] = cwiLoss;
    H_FAIL[r] = fail;
  }
  HT.phys = setsTot;
  HT.loadSW = setsTot * fLoadStrength(k, load);
  if (sess !== null && sess.doseStatus === 'unknown') HT.unknownDose = 1;
  return true;
}

/** RT sessions of the habitual week (the rule of core/compileSchedule.habitualWeek: N = round(sessions/wk) in 0..7, a
 *  `lifingCardioMix` share of them cardio). */
export function habitualRtSessions(sessionsPerWeek: number, mix: number): number {
  const n = Math.max(0, Math.min(7, Math.round(Number.isFinite(sessionsPerWeek) ? sessionsPerWeek : 0)));
  const m = Math.max(0, Math.min(1, Number.isFinite(mix) ? mix : 0));
  let nRt = 0;
  for (let i = 0; i < n; i++) if (!(Math.floor((i + 1) * m + 1e-9) > Math.floor(i * m + 1e-9))) nRt++;
  return nRt;
}

/** 09 §4.14 neural target N_max(TS)·h_S(V_wb)·f_loadS·f_FS(F_wb)·f_CWI,wb from the 7-day rings. */
function neuralTarget(s: MuscleState, k: MuscleK): number {
  let sN = 0;
  let sW = 0;
  for (let j = 0; j < RING; j++) {
    sN += s.setsTotHist[j]!;
    sW += s.loadSHist[j]!;
  }
  return nMax(k, s.ts) * hStrength(k, s.vWb) * (sN > 0 ? sW / sN : 1) * fFreqStrength(k, s.fWb) * s.cwiWb;
}

const finiteOr = (x: number, fallback: number): number => (Number.isFinite(x) ? x : fallback);

/**
 * 09 §4.9 gross accretion rate of region r on 7-day inputs, kg/d: `common` = kG·f_P(P₇)·f_age·u·(7-day mean day factors),
 * × G_pot,r·(1 − TS_r)·f_V(V_r)·f_F(F_r)·f_EP(e, P₇, TS_r)·H_r·κ_mem·ρ_reg·f_CWI,r. Caches f_V.
 */
function grossRate(s: MuscleState, k: MuscleK, r: number, common: number, e: number, q7: number): number {
  const v = s.vR[r]!;
  if (!(v > 0)) return 0;
  const g = s.gPot[r]!;
  const m = s.mAcc[r]!;
  const ts = clamp(m / g, 0, k.tsCap);
  const kMem = m < k.memThreshold * s.mPeak[r]! ? k.kMem : 1;
  const rho = 1 + (k.rhoReg[r]! - 1) * (1 - ts);
  let fv = s.fvF[r]!;
  if (v !== s.fvV[r]) {
    fv = fVolume(k, v);
    s.fvV[r] = v;
    s.fvF[r] = fv;
  }
  return common * g * (1 - ts) * fv * fFreq(k, s.fR[r]!) * fEnergyProtein(k, e, q7, ts) * s.hR[r]! * kMem * rho * s.cwiF[r]!;
}

/**
 * 09 §4.6 initial whole-body training status of `prof` (TS₀ and the potential it implies): Y_eff = training years known to
 * the body module (entered, or derived by resolveProfile), else the habits history bucket. Exported for the R-MAINT
 * planned-activity estimator (post-RT REE shield, `core/activityReference.ts`).
 */
export function trainingStatus0(k: MuscleK, prof: ResolvedProfile): Ts0Result {
  const female = prof.sex === 'female';
  const unspecified = prof.input.sexUnspecified === true;
  const dPotSex = unspecified ? 0.5 * (k.dFfmiPotM + k.dFfmiPotF) : female ? k.dFfmiPotF : k.dFfmiPotM;
  const tr = prof.body.training;
  const hist = prof.input.habits?.trainingHistory;
  const yBody = finiteOr(tr.trainingYearsEffective, 0);
  let yEff = yBody;
  if (prof.input.body.trainingYears === undefined && !(yBody > 0) && hist !== undefined) {
    yEff = hist === 'lt1y' ? k.histYearsLt1 : hist === '1to3y' ? k.histYears1to3 : hist === 'gt3y' ? k.histYearsGt3 : 0;
  }
  return initialTrainingStatus(k, dPotSex, yEff, tr.ffmi, tr.ffmiUntrainedRef);
}

/**
 * R-DETRAIN (MODEL_SPEC §1.9): the trained gains a person carries at t = 0 above the untrained, FFMI-derived set-point
 * (`equations.trainedGains0`; 0 without RT in the habitual week — then all of M_acc,0 is set-point) and the part of them
 * detraining can remove, `(1 − detrainFloorFrac)·trained`, kg whole body (D3-06: all of it at the central floor 0). Gains
 * accrued during a run detrain by the same rule.
 */
export function trainedGainsAtStart(k: MuscleK, prof: ResolvedProfile): { trainedKg: number; losableKg: number } {
  const hab = prof.habits;
  if (habitualRtSessions(hab.sessionsPerWeek, hab.lifingCardioMix) === 0) return { trainedKg: 0, losableKg: 0 };
  const ts0 = trainingStatus0(k, prof);
  const h = prof.heightM;
  const yEff = ts0.yearsEff ?? 0;
  const dTrain =
    prof.input.sexUnspecified === true
      ? 0.5 * (trainingFfmiOffset('male', yEff) + trainingFfmiOffset('female', yEff))
      : trainingFfmiOffset(prof.sex, yEff);
  const tr = prof.body.training;
  const g = trainedGains0(ts0.ts0 * ts0.dFfmiPot * h * h, h, tr.ffmi - tr.ffmiUntrainedRef, dTrain);
  return { trainedKg: g, losableKg: (1 - clamp(k.detrainFloorFrac, 0, 1)) * g };
}

const muscleCore = defineModule<MuscleState, MuscleK>({
  id: 'muscle',
  specSection: '§1.9',
  dossiers: '09 §4.1-4.17; 03 §4.2/4.5/4.7/4.8/4.10/4.14; 15 §4.10/4.12; 16 §4.0.1; 19 §4.3; 21 §4D-3',
  params: MUSCLE_PARAMS,
  reads: [
    'raAaQGH', 'energyBalanceFrac', 'ffmActKg', 'skeletalMuscleKg', 'mpsSleepMult', 'creatineSatFrac', 'etohPoolG',
    'strengthEaMult', 'ageYears', 'tissueMassKg', 'muscleGlycogenRel',
  ],
  writes: ['rtAccretionKgD', 'rtRetentionFrac', 'rtDoseFrac', 'smRtKg', 'rtVolumeWb', 'mpsStimWb', 'trainingStatus'],
  records: ['mps', 'strength', 'trainingStatus', 'rtMuscleGain'],

  prepare: (ctx) => {
    const k: MuscleK = readMuscleConstants(ctx.params, ctx.seriesEnabled[MI_MPS] === 1, ctx.events);
    k.scenario = readMuscleScenario(ctx.params);
    return k;
  },

  init: (k, ctx, bus) => {
    const n = N_REGIONS;
    const prof = ctx.profile;
    const female = prof.sex === 'female';
    const hab = prof.habits;
    // "currently training" = the habitual week (burn-in) contains resistance sessions (R-BURNIN)
    const currentlyTraining = habitualRtSessions(hab.sessionsPerWeek, hab.lifingCardioMix) > 0;
    const ts0 = trainingStatus0(k, prof);
    const h = prof.heightM;
    const gPotWb = ts0.dFfmiPot * h * h;
    // R-DETRAIN: the trained gains a habitual lifter carries above the untrained, FFMI-derived set-point (0 without habitual
    // RT: then all of M_acc,0 is the set-point, the habitual body being the steady state); the floor keeps a share of them
    const gTrWb = trainedGainsAtStart(k, prof).trainedKg;

    const gPot = new Float64Array(n);
    const mAcc = new Float64Array(n);
    const mBase = new Float64Array(n);
    const mFloor = new Float64Array(n);
    const hR = new Float64Array(n);
    const tLow = new Float64Array(n);
    const daysSince = new Float64Array(n);
    const kDecay = new Float64Array(n);
    const tLow0 = currentlyTraining ? 0 : k.detrainOnsetD + k.detrainRampD;
    let mSum = 0;
    for (let r = 0; r < n; r++) {
      gPot[r] = k.w[r]! * gPotWb;
      mAcc[r] = ts0.ts0 * gPot[r]!;
      const base = mAcc[r]! - k.w[r]! * gTrWb;
      mBase[r] = base > 0 ? base : 0;
      // D3-06: the floor follows the attained peak (M_peak = M_acc at t = 0 here; history, never a run label)
      mFloor[r] = detrainFloor(mAcc[r]!, mBase[r]!, k.detrainFloorFrac);
      hR[r] = currentlyTraining ? 1 : 0;
      tLow[r] = tLow0;
      daysSince[r] = 1e6;
      kDecay[r] = Math.exp(-1 / kernelTau(k, hR[r]!));
      mSum += mAcc[r]!;
    }
    const growth = growthScenarioFor(k, prof);
    const hWb = currentlyTraining ? 1 : 0;
    const tauX = k.p03.tauXUntrained + (k.p03.tauXTrained - k.p03.tauXUntrained) * hWb;
    const n0 = currentlyTraining ? k.n0Frac * nMax(k, ts0.ts0) : 0;
    const q0 = prof.habitualProteinG / Math.max(1, prof.weightKg);
    const qRing = new Float64Array(RING).fill(q0);
    const smBus = bus.skeletalMuscleKg;
    const m0 = Number.isFinite(smBus) && smBus > 0 ? smBus : prof.body.skeletalMuscleKg;

    bus.rtAccretionKgD = 0;
    bus.rtRetentionFrac = 0;
    bus.rtDoseFrac = 0;
    bus.smRtKg = 0;
    bus.rtVolumeWb = 0;
    bus.mpsStimWb = 0;
    bus.trainingStatus = ts0.ts0;

    return {
      heightM: h,
      female: female ? 1 : 0,
      currentlyTraining: currentlyTraining ? 1 : 0,
      growthState: GROWTH_STATE_CODE[growth.state],
      growthScenario: growth.scenario === 'progress' ? 1 : 0,
      setsHist: new Float64Array(n * RING),
      histIdx: 0,
      todaySets: new Float64Array(n),
      vR: new Float64Array(n),
      fR: new Float64Array(n),
      boutKey: Array.from({ length: BOUT_SLOTS }, () => ''),
      boutOrigin: new Float64Array(BOUT_SLOTS).fill(-1e9),
      boutSess: new Float64Array(BOUT_SLOTS).fill(-1),
      boutEnd: new Float64Array(BOUT_SLOTS).fill(-1e9),
      boutOpen: new Float64Array(BOUT_SLOTS),
      boutEff: new Float64Array(BOUT_SLOTS * n),
      boutRaw: new Float64Array(BOUT_SLOTS * n),
      legacyIn: 0,
      unknownDoseFromDay: -1,
      unknownDoseToday: 0,
      failToday: new Float64Array(n),
      lastFail: new Float64Array(n),
      daysSinceTrained: daysSince,
      cwiLossHist: new Float64Array(n * RING),
      cwiLossToday: new Float64Array(n),
      cwiDayTot: new Float64Array(RING),
      hR,
      wR: new Float64Array(n),
      mAcc,
      mAcc0: Float64Array.from(mAcc),
      mPeak: Float64Array.from(mAcc),
      mBase,
      mFloor,
      bRef: new Float64Array(n),
      cwiF: new Float64Array(n).fill(1),
      gPot,
      tLow,
      fatR: new Float64Array(n),
      nNeural: n0,
      strength0: 1 + n0,
      fatRef: 1,
      eaRef: 1,
      fatRing: new Float64Array(RING),
      eaRing: new Float64Array(RING),
      baseCount: 0,
      t0Rec: 0,
      m0,
      setsTotHist: new Float64Array(RING),
      loadSHist: new Float64Array(RING),
      todaySetsTot: 0,
      todayLoadSW: 0,
      kAmpB: new Float64Array(BOUT_SLOTS * n),
      kAgeB: new Float64Array(BOUT_SLOTS * n).fill(-1),
      kCommitB: new Float64Array(BOUT_SLOTS * n),
      rampOn: new Float64Array(BOUT_SLOTS),
      kResid: new Float64Array(n),
      kDecay,
      kDecayH: Float64Array.from(hR),
      fvV: new Float64Array(n).fill(-1),
      fvF: new Float64Array(n),
      sMps: new Float64Array(n),
      kernelActive: 0,
      xSlow: 0,
      xFast: 0,
      xRT: 0,
      xActive: 0,
      xDecay: Math.exp(-1 / tauX),
      xHalf: Math.exp(-0.5 / tauX),
      refractoryR: 0,
      mpsIdx: 100,
      aiDay: 0,
      kAgeMpsVal: kAgeMps(k.p03, prof.ageYears),
      ffmDay: prof.ffm0Kg,
      sleepMult: 1,
      fEMps: 1,
      arSteps: 1,
      arFed: 1,
      bxMult: 1,
      qRing,
      qIdx: 0,
      qToday: q0,
      eDist: 1,
      mealT: new Float64Array(MAX_MEALS),
      mealQ: new Float64Array(MAX_MEALS),
      mealP: new Float64Array(MAX_MEALS),
      poolAtRt: 0,
      alcDoseG: 0,
      protWinG: 0,
      winLeft: 0,
      protLeft: 0,
      alcPending: 0,
      winTouched: 0,
      trainedToday: 0,
      eRing: new Float64Array(RING),
      dRing: new Float64Array(RING).fill(1),
      ts: ts0.ts0,
      vWb: 0,
      fWb: 0,
      hWb,
      cwiWb: 1,
      fatAcute: 0,
      strength: 100,
      mAcc0Sum: mSum,
      accToday: 0,
      detToday: 0,
      detrainFlag: 0,
    };
  },

  startDay: (s, k, bus, day) => {
    s.t0Rec = 0;
    const age = bus.ageYears;
    const ffm = bus.ffmActKg > 1 ? bus.ffmActKg : 1;
    const bw = bus.tissueMassKg > 1 ? bus.tissueMassKg : 1;
    s.kAgeMpsVal = kAgeMps(k.p03, age);
    s.ffmDay = ffm;
    s.sleepMult = bus.mpsSleepMult;
    // f_P input (R-RT revised): quality-weighted protein P·Q_daily (03 §4.10) per kg body mass; 09 ρ(P) uses plain g/kg.
    s.qToday = (day.proteinG * (day.proteinQDaily > 0 ? day.proteinQDaily : 1)) / bw;
    // 03 §4.8 distribution efficiency: neutral 1 in production (D3-04); the legacy curve only in its research mode, so
    // burn-in (B_ref) and future accretion always share one mode
    if ((k.scenario?.eDistMode ?? 0) >= 0.5) {
      const nm = day.nMeals < MAX_MEALS ? day.nMeals : MAX_MEALS;
      for (let i = 0; i < nm; i++) {
        const m = day.meals[i]!;
        s.mealT[i] = m.clockH;
        s.mealP[i] = m.proteinG;
        s.mealQ[i] = m.proteinG * m.proteinQMeal;
      }
      s.eDist = distributionEfficiency(k.p03, nm, s.mealT, s.mealQ, s.mealP, ffm, age);
    } else s.eDist = 1;

    if (k.mpsEnabled) {
      // 03 §4.5 f_E,MPS with x_P (03 §4.4.2), first-order onset/offset τ 2 d
      const deficit = -bus.energyBalanceFrac;
      const bf = clamp((bw - ffm) / bw, 0, 0.9);
      const xP = proteinAdequacy(k.p03, (s.qToday * bw) / ffm, deficit, leanness(k.p03, bf, s.female === 1));
      const target = fEnergyMps(k.p03, deficit, xP);
      s.fEMps = target + (s.fEMps - target) * k.p03.eMpsF;
      // 03 §4.14 anabolic resistance of fed MPS: step reduction (older users, τ 5 d on / 7 d off) and obesity
      const arT = day.steps < k.p03.arStepsThreshold && age >= k.p03.arStepsAgeMin ? k.p03.arStepsFed : 1;
      s.arSteps = arT + (s.arSteps - arT) * (arT < s.arSteps ? k.p03.arOnF : k.p03.arOffF);
      const ob = obesityRamp(k.p03, bw / (s.heightM * s.heightM));
      s.arFed = s.arSteps * (1 - (1 - k.p03.arObese) * ob);
      s.bxMult = 1 - (1 - k.p03.bxObese) * ob;
    }
  },

  stepHour: (s, k, bus, hour, day, clock) => {
    const n = N_REGIONS;
    // ---- 09 §4.1 effective sets of this hour (per set group with drawn factors, summed per region inside each physical
    //      bout; D3-01, A1-020)
    let dI = 0;
    if (hourSets(s, k, hour, day, clock)) {
      const glyLow = bus.muscleGlycogenRel < k.fastHVGlycogenRel;
      const mps = k.mpsEnabled;
      for (let j = 0; j < HT.nSlots; j++) {
        const b = H_SLOT[j]!;
        const base = b * n;
        for (let r = 0; r < n; r++) {
          const i = base + r;
          const raw = H_RAW[i]!;
          if (!(raw > 0)) continue;
          const mult = H_MULT[i]!;
          let eff = raw * mult;
          const before = s.boutRaw[i]!;
          if (glyLow) {
            // f_fastHV: sets beyond the 10th of this region in one physical bout count ×0.95 when glycogen-depleted (at
            // the bout's raw-weighted group multiplier of the hour, so the order of its groups inside the hour does not
            // matter); another bout in the same hour has its own count (A1-020)
            const over = Math.max(0, before + raw - k.fastHVSets) - Math.max(0, before - k.fastHVSets);
            eff -= over * mult * (1 - k.fFastHV);
          }
          s.boutRaw[i] = before + raw;
          const prevEff = s.boutEff[i]!;
          const newEff = prevEff + eff;
          s.boutEff[i] = newEff;
          s.todaySets[r] = s.todaySets[r]! + eff;
          const cwiShare = H_CWI[i]!;
          if (cwiShare > 0) s.cwiLossToday[r] = s.cwiLossToday[r]! + eff * cwiShare;
          if (H_FAIL[i]! > 0) s.failToday[r] = 1;
          // 09 §4.4 kernel: one pulse per region and physical bout; a(s) saturates on the bout's effective sets
          const hr = s.hR[r]!;
          const ampNew = kernelAmp(k, hr, newEff);
          if (prevEff === 0) {
            // first sets of this region in this bout; a still-ramping pulse left in this slot by an earlier bout is frozen
            // into the residual at its current value (approximation; distinct concurrent bouts have their own slots)
            if (s.kAgeB[i]! >= 0) {
              const ph = (s.kAgeB[i]! + 0.5) / k.kernelRampH;
              s.kResid[r] = s.kResid[r]! + s.kAmpB[i]! * (ph < 1 ? ph : 1);
            }
            s.kAgeB[i] = 0;
            s.kCommitB[i] = 0;
            s.kAmpB[i] = ampNew;
          } else if (s.kAgeB[i]! >= 0) {
            s.kAmpB[i] = ampNew - s.kCommitB[i]!; // bout continues inside the ramp phase of its pulse
          } else {
            // bout continues after its first pulse entered the exponential phase: new pulse with the increment
            s.kCommitB[i] = kernelAmp(k, hr, prevEff);
            s.kAgeB[i] = 0;
            s.kAmpB[i] = ampNew - s.kCommitB[i]!;
          }
          s.rampOn[b] = 1;
          // 03 §4.7 bout stimulus I_b (muscle-mass weighted, whole body; display layer only), per physical bout
          if (mps) dI += k.w[r]! * (boutStimulus(k, newEff) - boutStimulus(k, prevEff));
        }
      }
      // the legacy slot's bout stays open while legacy-path hours carry sets; a group-path hour closes it
      if (H_SLOT[0] === LEGACY_SLOT) s.legacyIn = 1;
      else if (s.legacyIn) {
        clearBout(s, LEGACY_SLOT);
        s.legacyIn = 0;
      }
      if (HT.unknownDose) s.unknownDoseToday = 1;
      s.kernelActive = 1;
      // 09 §4.14 neural practice: physical sets (group path) and their load-weighted f_loadS, never effective sets
      s.todaySetsTot += HT.phys;
      s.todayLoadSW += HT.loadSW;
      s.trainedToday = 1;
      // 15 §4.10 window opens at the end of the session
      s.poolAtRt = bus.etohPoolG;
      s.alcPending = 1;
      s.winLeft = k.alcWindowH;
      s.protLeft = k.alcProtWindowH;
      s.protWinG = 0;
    } else {
      // the legacy merged-hour path keeps its pre-group bout rule: a set-free hour ends its bout
      if (s.legacyIn) {
        clearBout(s, LEGACY_SLOT);
        s.legacyIn = 0;
      }
      if (s.winLeft > 0) {
        if (s.alcPending) {
          s.alcDoseG += s.poolAtRt;
          s.alcPending = 0;
        }
        s.alcDoseG += hour.alcoholG;
        s.winTouched = 1;
        if (s.protLeft > 0) {
          s.protWinG += hour.proteinG;
          s.protLeft -= 1;
        }
        s.winLeft -= 1;
      }
    }

    // ---- 09 §4.4 kernel value at the hour midpoint, then advance one hour (ramps per bout slot, one shared residual)
    let wb = 0;
    if (s.kernelActive) {
      let any = 0;
      const ramp = k.kernelRampH;
      const w = k.w;
      const kAge = s.kAgeB;
      const kAmp = s.kAmpB;
      const kResid = s.kResid;
      const kDecay = s.kDecay;
      const sMps = s.sMps;
      let hasRamp = false;
      for (let b = 0; b < BOUT_SLOTS; b++) {
        if (s.rampOn[b] === 0) continue;
        if (!hasRamp) { RAMP_V.fill(0); hasRamp = true; }
        const base = b * n;
        let on = 0;
        for (let r = 0; r < n; r++) {
          const i = base + r;
          const age = kAge[i]!;
          if (age < 0) continue;
          const dt = age + 0.5;
          if (dt < ramp) {
            RAMP_V[r] = RAMP_V[r]! + (kAmp[i]! * dt) / ramp;
            kAge[i] = age + 1;
            on = 1;
          } else {
            kResid[r] = kResid[r]! + kAmp[i]! * Math.exp(-(dt - ramp) / kernelTau(k, s.hR[r]!));
            kAge[i] = -1;
            kAmp[i] = 0;
          }
        }
        s.rampOn[b] = on;
        if (on) any = 1;
      }
      for (let r = 0; r < n; r++) {
        const v = kResid[r]! + (hasRamp ? RAMP_V[r]! : 0);
        sMps[r] = v;
        wb += w[r]! * v;
        const res = kResid[r]! * kDecay[r]!;
        if (res > 1e-9) {
          kResid[r] = res;
          any = 1;
        } else {
          kResid[r] = 0;
        }
      }
      s.kernelActive = any;
      if (!any) sMps.fill(0);
    }
    bus.mpsStimWb = wb;

    // ---- 03 §4.7 MPS display layer (never integrated into mass; skipped when the `mps` series is not requested)
    if (k.mpsEnabled) {
      // X_RT = Σ I_b·[e^{−Δ/τ_X} − e^{−Δ/τ_on}]/0.95 (midpoint value), τ_X by habituation
      if (dI > 0) {
        s.xSlow += dI * s.xHalf;
        s.xFast += dI * k.p03.xOnHalfF;
        s.xActive = 1;
      }
      let x = 0;
      if (s.xActive) {
        x = (s.xSlow - s.xFast) / k.p03.xNorm;
        if (x < 0) x = 0;
        s.xSlow *= s.xDecay;
        s.xFast *= k.p03.xOnF;
        if (s.xSlow < 1e-9) {
          s.xSlow = 0;
          s.xFast = 0;
          s.xActive = 0;
        }
      }
      s.xRT = x;
      // 03 §4.7B MPS index
      const xAa = bus.raAaQGH / s.ffmDay;
      const sFeed = feedingStimulus(xAa, s.kAgeMpsVal);
      const r0 = s.refractoryR;
      const r1 = refractoryStep(k.p03, r0, sFeed);
      s.refractoryR = r1;
      const rBar = 0.5 * (r0 + r1);
      const sleep = s.sleepMult;
      const basal = s.fEMps * (1 + k.p03.aX * x);
      const fed = s.fEMps * s.arFed * k.p03.aFed * sFeed * (1 - rBar) * (1 + k.p03.bX * s.bxMult * x);
      s.mpsIdx = 100 * (basal + fed) * sleep;
      s.aiDay += k.p03.s0 * fed * sleep;
    }
  },

  endOfDay: (s, k, bus, _day, clock) => {
    const n = N_REGIONS;
    // Burn-in (R-BURNIN): the habitual week runs every state except the training-attributable mass and events.
    const burn = clock.day < 0;
    const age = bus.ageYears;
    const bw = bus.tissueMassKg > 1 ? bus.tissueMassKg : 1;
    const slot = s.histIdx;

    // 15 §4.10 alcohol after training; 15 §4.12 creatine; 16 sleep; 03 E_dist: the day-specific accretion factors
    let fAlc = 1;
    if ((s.winTouched || s.trainedToday) && s.alcDoseG > 0) {
      fAlc = fAlcohol(k, s.alcDoseG / bw, s.protWinG >= k.alcProtGkg * bw);
    }
    const dDay = bus.mpsSleepMult * fAlc * fCreatine(k, bus.creatineSatFrac) * s.eDist;

    // effective protein, energy balance and day factors = 7-day means (03 §4.2 integration window; 09's e is a
    // study-average balance)
    const qi = s.qIdx;
    s.qRing[qi] = s.qToday;
    s.eRing[qi] = bus.energyBalanceFrac;
    s.dRing[qi] = dDay;
    s.qIdx = (qi + 1) % RING;
    let q7 = 0;
    let e7 = 0;
    let d7 = 0;
    for (let j = 0; j < RING; j++) {
      q7 += s.qRing[j]!;
      e7 += s.eRing[j]!;
      d7 += s.dRing[j]!;
    }
    q7 /= RING;
    e7 /= RING;
    d7 /= RING;
    const common = k.kG * fProtein(k, q7) * fAge(k, age) * k.uIndividual * d7;
    const dShare = d7 > 0 ? dDay / d7 : 1;
    const vm = vMaintenance(k, age);

    // 21 §4D-4 CWI ring: today's total, and whether any CWI-followed session lies in the 7-day window
    let cwiTot = 0;
    for (let r = 0; r < n; r++) cwiTot += s.cwiLossToday[r]!;
    s.cwiDayTot[slot] = cwiTot;
    let cwiAny = 0;
    for (let j = 0; j < RING; j++) cwiAny += s.cwiDayTot[j]!;

    let accSum = 0;
    let detSum = 0;
    let vWb = 0;
    let fWb = 0;
    let hWb = 0;
    let lossWb = 0;
    let mSum = 0;
    let gSum = 0;
    let fatWb = 0;
    for (let r = 0; r < n; r++) {
      const sets = s.todaySets[r]!;
      const base = r * RING;
      s.setsHist[base + slot] = sets;
      s.cwiLossHist[base + slot] = s.cwiLossToday[r]!;
      let v = 0;
      let f = 0;
      for (let j = 0; j < RING; j++) {
        const x = s.setsHist[base + j]!;
        v += x;
        if (x > 0) f++;
      }
      s.vR[r] = v;
      s.fR[r] = f;
      let cwiF = 1;
      if (cwiAny > 0 && v > 0) {
        let loss = 0;
        for (let j = 0; j < RING; j++) loss += s.cwiLossHist[base + j]!;
        cwiF = 1 - loss / v;
        lossWb += k.w[r]! * loss;
      }
      s.cwiF[r] = cwiF;

      // 09 §4.5 habituation (exact daily exponentials) and swelling
      const h = f > 0 ? 1 - (1 - s.hR[r]!) * k.habUpF : s.hR[r]! * k.habDownF;
      s.hR[r] = h;
      const wT = k.swellA * (1 - h) * (v < k.swellVRef ? v / k.swellVRef : 1);
      s.wR[r] = wT + (s.wR[r]! - wT) * k.swellF;

      // 09 §4.10 low-volume day count (runs in burn-in as well)
      const tl = v < vm ? s.tLow[r]! + 1 : 0;
      s.tLow[r] = tl;

      const g = s.gPot[r]!;
      const m = s.mAcc[r]!;
      let mNew = m;
      if (!burn) {
        // 09 §4.9 accretion: excess of the gross rate over the habitual reference (0 without habitual RT); the day's
        // share follows its day factors. Below the previous peak (only reachable through detraining) the lost muscle is
        // regained at 09's full retraining rate — gap term, habituation and κ_mem, no reference subtracted — up to M_peak
        // (ruling R-REGAIN, 2026-10-01); beyond it the excess form holds, so the habitual week stays at its equilibrium.
        const gross = grossRate(s, k, r, common, e7, q7);
        const peak = s.mPeak[r]!;
        let a: number;
        if (m < peak) {
          a = gross * dShare;
          if (m + a > peak) a = peak - m;
        } else {
          const ex = gross - s.bRef[r]!;
          a = ex > 0 ? ex * dShare : 0;
        }
        // 09 §4.10 detraining towards the floor (D3-06: the set-point centrally; history-based in research scenarios)
        const d = detrainLoss(k, tl, v, vm, m, s.mFloor[r]!);
        mNew = m + a - d;
        if (mNew < s.mBase[r]!) mNew = s.mBase[r]!;
        if (mNew > g) mNew = g;
        s.mAcc[r] = mNew;
        if (mNew > s.mPeak[r]!) {
          s.mPeak[r] = mNew;
          // D3-06: a nonzero retained share (research scenario) follows the attained peak; 0 centrally (floor = set-point)
          if (k.detrainFloorFrac > 0) s.mFloor[r] = detrainFloor(mNew, s.mBase[r]!, k.detrainFloorFrac);
        }
        accSum += a;
        detSum += d;
      }

      // 09 §4.11 fatigue (performance only)
      const fail = s.failToday[r]!;
      if (sets > 0) s.lastFail[r] = fail;
      s.fatR[r] = s.fatR[r]! * (s.lastFail[r]! > 0 ? k.fatFailF : k.fatF) + k.cFat * sets * (1 + k.fatFailBoost * fail);
      s.daysSinceTrained[r] = sets > 0 ? 0 : s.daysSinceTrained[r]! + 1;

      const w = k.w[r]!;
      vWb += w * v;
      fWb += w * f;
      hWb += w * h;
      mSum += mNew;
      gSum += g;
      fatWb += w * (s.fatR[r]! < k.fatCap ? s.fatR[r]! : k.fatCap);
      if (Math.abs(h - s.kDecayH[r]!) > 1e-7) {
        s.kDecay[r] = Math.exp(-1 / kernelTau(k, h));
        s.kDecayH[r] = h;
      }
      s.todaySets[r] = 0;
      s.failToday[r] = 0;
      s.cwiLossToday[r] = 0;
    }
    s.histIdx = (slot + 1) % RING;
    const tsWb = gSum > 0 ? mSum / gSum : 0;
    s.ts = tsWb;
    s.vWb = vWb;
    s.fWb = fWb;
    s.hWb = hWb;
    s.cwiWb = vWb > 0 ? 1 - lossWb / vWb : 1;
    s.fatAcute = fatWb;
    s.accToday = accSum;
    s.detToday = detSum;

    // 03 X_RT decay constants for tomorrow (τ_X 36 h untrained → 12 h habituated; display layer only)
    if (k.mpsEnabled) {
      const tauX = k.p03.tauXUntrained + (k.p03.tauXTrained - k.p03.tauXUntrained) * hWb;
      s.xDecay = Math.exp(-1 / tauX);
      s.xHalf = Math.exp(-0.5 / tauX);
    }

    // 09 §4.14 neural strength component (R-STR slope)
    s.setsTotHist[slot] = s.todaySetsTot;
    s.loadSHist[slot] = s.todayLoadSW;
    if (vWb > 0) {
      const target = neuralTarget(s, k);
      s.nNeural = target + (s.nNeural - target) * k.nUpF;
    } else {
      s.nNeural *= k.nOffF;
    }

    if (burn) {
      // habitual-week references of the strength index (latched in endBurnIn)
      const ea = bus.strengthEaMult;
      s.fatRing[slot] = 1 - fatWb;
      s.eaRing[slot] = Number.isFinite(ea) && ea > 0 ? ea : 1;
      if (s.baseCount < RING) s.baseCount++;
    } else {
      // §7.1 detrainingOnset: λ > 0 in a region that had effective sets in the last 8 weeks (burn-in included); the
      // reference region is the one with the largest detrainable M_acc (above the R-DETRAIN floor)
      let best = -1;
      let bestM = -1;
      for (let r = 0; r < n; r++) {
        if (s.daysSinceTrained[r]! > k.detrainEventWindowD) continue;
        const dyn = s.mAcc[r]! - s.mFloor[r]! + 1e-9 * k.w[r]!;
        if (dyn > bestM) {
          bestM = dyn;
          best = r;
        }
      }
      const lamBest = best >= 0 ? detrainLambda(k, s.tLow[best]!) : 0;
      if (lamBest > 0) {
        if (!s.detrainFlag) {
          k.events.emit('detrainingOnset', clock.hourIndex, s.tLow[best]!);
          s.detrainFlag = 1;
        }
      } else {
        s.detrainFlag = 0;
      }
    }

    // daily signals (read by composition / energy / activity / wellbeing next day)
    const dose = clamp(vWb / vRetention(k, age), 0, 1);
    bus.rtAccretionKgD = accSum - detSum;
    bus.rtRetentionFrac = k.rMax * dose;
    bus.rtDoseFrac = dose;
    bus.smRtKg = burn ? 0 : k.smFrac * (mSum - s.mAcc0Sum);
    bus.rtVolumeWb = vWb;
    bus.trainingStatus = tsWb;

    // A1-022: first plan day whose sets include an unknown hard-set count (a burn-in day conditions the run from day 0)
    if (s.unknownDoseToday) {
      if (s.unknownDoseFromDay < 0) s.unknownDoseFromDay = burn ? 0 : clock.day;
      s.unknownDoseToday = 0;
    }

    // reset day accumulators (the alcohol/protein windows themselves carry over midnight)
    s.todaySetsTot = 0;
    s.todayLoadSW = 0;
    s.alcDoseG = 0;
    s.winTouched = 0;
    s.trainedToday = 0;
    s.aiDay = 0;
  },

  endBurnIn: (s, k, bus) => {
    // t = 0 references (R-BURNIN): training-attributable lean, skeletal muscle (composition has just reset SM₀)
    let m = 0;
    for (let r = 0; r < N_REGIONS; r++) {
      s.mAcc0[r] = s.mAcc[r]!;
      m += s.mAcc[r]!;
    }
    s.mAcc0Sum = m;
    const sm = bus.skeletalMuscleKg;
    if (Number.isFinite(sm) && sm > 0) s.m0 = sm;
    // habitual-training equilibrium: reference gross rate of the habitual week at maintenance (e = 0) and habitual
    // protein; energy re-anchors at maintenance, so the energy-balance ring restarts at 0
    s.eRing.fill(0);
    let q7 = 0;
    let d7 = 0;
    for (let j = 0; j < RING; j++) {
      q7 += s.qRing[j]!;
      d7 += s.dRing[j]!;
    }
    q7 /= RING;
    d7 /= RING;
    const common = k.kG * fProtein(k, q7) * fAge(k, bus.ageYears) * k.uIndividual * d7;
    // D3-05: the reference is latched only under the 'stable' growth scenario (unknown state's numerical anchor, or a stated
    // plateau); the progress scenario books the gross rate (existing caps) — never because sessionsPerWeek > 0 alone
    for (let r = 0; r < N_REGIONS; r++) s.bRef[r] = s.currentlyTraining && s.growthScenario === 0 ? grossRate(s, k, r, common, 0, q7) : 0;
    // habitual trainee: the neural component sits at its equilibrium for the habitual week (09 §4.14 target), so the
    // strength index does not drift at habitual maintenance
    if (s.vWb > 0) s.nNeural = neuralTarget(s, k);
    s.strength0 = 1 + s.nNeural;
    // habitual-week means of (1 − Fat_acute) and M_EA: the index averages 100 over the habitual week
    const nb = s.baseCount;
    if (nb > 0) {
      let fa = 0;
      let ea = 0;
      for (let j = 0; j < RING; j++) {
        fa += s.fatRing[j]!;
        ea += s.eaRing[j]!;
      }
      s.fatRef = fa / nb;
      s.eaRef = ea / nb;
    } else {
      s.fatRef = 1 - s.fatAcute;
      const ea = bus.strengthEaMult;
      s.eaRef = Number.isFinite(ea) && ea > 0 ? ea : 1;
    }
    if (!(s.fatRef > 0)) s.fatRef = 1;
    s.t0Rec = 1;
    s.detrainFlag = 0;
    bus.rtAccretionKgD = 0;
    bus.smRtKg = 0;
    bus.trainingStatus = s.ts;
  },

  recordHour: (s, _k, _bus, out) => {
    out[MI_MPS] = s.mpsIdx;
  },

  recordDay: (s, k, bus, out) => {
    const sm = bus.skeletalMuscleKg;
    let ratio = s.m0 > 0 && Number.isFinite(sm) && sm > 0 ? sm / s.m0 : 1;
    if (k.strAlpha !== 1) ratio = Math.pow(ratio, k.strAlpha);
    // fatigue and M_EA relative to their habitual-week means; the t = 0 capture is the habitual mean itself (100)
    const fatTerm = s.t0Rec ? 1 : (1 - s.fatAcute) / s.fatRef;
    const ea = bus.strengthEaMult;
    const eaTerm = s.t0Rec ? 1 : (Number.isFinite(ea) && ea > 0 ? ea : 1) / s.eaRef;
    s.strength = (100 * (1 + s.nNeural) * ratio * fatTerm * eaTerm) / s.strength0;
    out[MI_STRENGTH] = s.strength;
    out[MI_TS] = 100 * s.ts;
    let m = 0;
    for (let r = 0; r < N_REGIONS; r++) m += s.mAcc[r]!;
    out[MI_RTGAIN] = m - s.mAcc0Sum;
  },
});

/**
 * Hook-aware signal declarations (D8-07, C7; checked by `checkSignalHooks`). Muscle runs after moderators, intake, fuel and
 * composition and before wellbeing: age and the sleep MPS multiplier (moderators' startDay), the energy-balance fraction
 * (composition's startDay), hourly amino-acid/ethanol/glycogen signals and composition's hourly tissue mass are today's
 * values (lag 0); FFM_act read in startDay is the previous hour's (lag 1); wellbeing's strength multiplier is written later
 * in endOfDay, so muscle's endOfDay reads the previous day's value (lag 1) and recordDay reads today's (lag 0).
 */
const MUSCLE_SIGNAL_HOOKS: readonly SignalHookDecl[] = [
  ...(['trainingStatus', 'rtAccretionKgD', 'smRtKg'] as const).flatMap((signal) => [
    { signal, access: 'write', hook: 'init' } as const,
    { signal, access: 'write', hook: 'endOfDay' } as const,
    { signal, access: 'write', hook: 'endBurnIn' } as const,
  ]),
  ...(['rtDoseFrac', 'rtRetentionFrac', 'rtVolumeWb'] as const).flatMap((signal) => [
    { signal, access: 'write', hook: 'init' } as const,
    { signal, access: 'write', hook: 'endOfDay' } as const,
  ]),
  { signal: 'mpsStimWb', access: 'write', hook: 'init' },
  { signal: 'mpsStimWb', access: 'write', hook: 'stepHour' },
  ...(['ageYears', 'mpsSleepMult', 'energyBalanceFrac'] as const).flatMap((signal) => [
    { signal, access: 'read', hook: 'startDay', lag: 0 } as const,
    { signal, access: 'read', hook: 'endOfDay', lag: 0 } as const,
  ]),
  { signal: 'ageYears', access: 'read', hook: 'endBurnIn' },
  { signal: 'ffmActKg', access: 'read', hook: 'startDay', lag: 1 },
  { signal: 'tissueMassKg', access: 'read', hook: 'startDay', lag: 1 },
  { signal: 'tissueMassKg', access: 'read', hook: 'endOfDay', lag: 0 },
  { signal: 'creatineSatFrac', access: 'read', hook: 'endOfDay', lag: 0 },
  ...(['raAaQGH', 'etohPoolG', 'muscleGlycogenRel'] as const).map((signal) => ({ signal, access: 'read', hook: 'stepHour', lag: 0 }) as const),
  { signal: 'skeletalMuscleKg', access: 'read', hook: 'init' },
  { signal: 'skeletalMuscleKg', access: 'read', hook: 'endBurnIn' },
  { signal: 'skeletalMuscleKg', access: 'read', hook: 'recordDay', lag: 0 },
  { signal: 'strengthEaMult', access: 'read', hook: 'endOfDay', lag: 1 },
  { signal: 'strengthEaMult', access: 'read', hook: 'recordDay', lag: 0 },
  { signal: 'strengthEaMult', access: 'read', hook: 'endBurnIn' },
];

/** The muscle module with its hook-aware signal declarations (`defineModule` does not forward `signalHooks`). */
export const muscleModule: EngineModule<MuscleState, MuscleK> = { ...muscleCore, signalHooks: MUSCLE_SIGNAL_HOOKS };
