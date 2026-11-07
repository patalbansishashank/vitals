/**
 * The simulation loop (docs/MODEL_SPEC.md §3): init → burn-in → endBurnIn → for each day { resolve runtime inputs →
 * startDay → 24 × stepHour (+ recordHour) → endOfDay → recordDay → checks → abort test } → finalize.
 *
 * Hot-path rules: nothing inside the day/hour loops allocates. All buffers (hour table, frames, rings, event buffer)
 * are created before the loop. Determinism: no Math.random / Date inside the engine (timing uses performance.now()
 * only for `meta.runtimeMs`, which is not part of the physics).
 *
 * Performance notes (MODEL_SPEC §0.3, O-11): canonical hourly hooks use guarded stable bound calls; custom registries
 * use the unrolled dispatch (`core/dispatch.ts`, monomorphic call site per module index); `recordHour`/`recordDay` are called only for modules that own at least one
 * enabled series (planner runs record a handful of series); one hour table and one HourInput serve burn-in and run.
 *
 * 2026-10-18 contracts (W0-core): every run, snapshot and result carries the contract fingerprint (C7; a snapshot captured
 * under other contracts is never restored); measured lab baselines are the exact t = 0 values with an out-of-domain status
 * on the projection when the model could not start from them (D7-02); series statuses are closed over their output
 * dependencies (C6); the run states its weakest causal resolution and named approximations (D2-01); runtime-resolved days
 * refresh their resolved exposure summary (D4-01); `initialStateFingerprint` binds a run's initial state for certificates
 * (D4-03).
 *
 * W1-core (2026-10-18): a numerical tissue floor ends the run with a model-limit status and the last fully conserved hour
 * (`meta.validity`, D1-08; never clamp-and-continue); the actually applied intake correction is booked per day
 * (`meta.offsetsApplied`, D5-03); day 0 starts after the last observed sleep episode (`CompiledSchedule.initialSleep`,
 * D8-06); ensemble quantiles use the stochastic members only (`core/bands.ts`, D8-02); the modules' run statuses and named
 * assumptions (composition partition domains and tissue floor, cardiometabolic response validity, wellbeing exploratory
 * outputs, activity/muscle/intake assumptions) are put on the recorder and `meta.assumptions` at finalize (C6).
 *
 * W2-core (2026-10-18): the SafetyTrace is allocated with every field of its contract — the eating-day EA alias, the
 * calendar energy-availability ledger and windows with their coverage (D4-04) and end-of-day fat mass — as trace-only
 * quantities usable as early-abort bounds; day-stamped snapshots key on the trace layout and restore only with the whole
 * trace history of the days before them (C7).
 *
 * Re-audit 2026-10-19 (stage 1): the compiled inputs' own unknowns condition the outputs that depend on them, from the first
 * affected day and whatever the requested series (`applyInputDependencyStatuses`: unknown macro allocation, unknown protein,
 * a reported-energy source conflict, polyols without a substrate route, an unknown hard-set count; A1-013/A1-022/A1-025/
 * A1-031); the activity and muscle providers' statuses reach the recorder (A1-041); an out-of-domain measured baseline makes
 * every modelled sample unsupported from index 0 while the t = 0 anchor stays exact (A1-052); both operands of the step
 * ledger disclose an unresolved overlap (A1-040); explicitly selected structural modes and caller-fixed draw-fixed values
 * hold in the nominal run and every ensemble member (A1-065); ensemble members cross the reducer as envelopes with their
 * status, validity and abort (A1-049).
 */
import { CONTRACT_FINGERPRINT, contentHash, weakestResolution, type CausalResolution, type OutputStatus, type UncertaintyKind } from '@/lib/bodyContracts';
import type { AnyEngineModule, EventSink, ModuleContext, StepClock } from '../types/module';
import type { ModelParams, ParamDef } from '../types/params';
import type { LabBaselines, PersonProfile, ResolvedProfile } from '../types/profile';
import { NUTRIENT_UNKNOWN_BIT, type CompiledSchedule, type DayInput } from '../types/inputs';
import type { Schedule } from '../types/schedule';
import type {
  AnchorApplied,
  AnchorSpec,
  BandedResult,
  DomainValidity,
  EngineSnapshot,
  ObservedAnchor,
  OffsetApplied,
  RunOptions,
  SafetyTrace,
  SafetyTraceKey,
  SeriesStatusMeta,
  SimulationResult,
} from '../types/result';
import { EVENT_TYPES, type SimEvent, type SimEventType, EVENT_CODE } from '../types/events';
import { createSignalBus, SIGNAL_DEFS, type SignalBus } from '../types/signals';
import { MI, N_SERIES, SERIES, SERIES_INDEX, SIGNAL_MIRRORS, seriesDef, type SeriesId } from '../types/metrics';
import { MODULES, hasDefaultHourOrder, stepDefaultHour } from './moduleRegistry';
import { CARDIOMETABOLIC_DOMAIN, cardiometabolicObservedAnchors } from '../model/cardiometabolic/constants';
import { ENERGY_INTAKE_ASSUMPTIONS, proteinIsLowerBound } from '../model/energy';
import { compositionModelLimit, compositionOutputStatuses, type CompositionState } from '../model/composition';
import { cardiometabolicRunStatus, type CardiometabolicK, type CardiometabolicState } from '../model/cardiometabolic';
import { wellbeingOutputStatus, type WellbeingState } from '../model/wellbeing';
import { ACTIVITY_MODEL_ASSUMPTIONS, activityOutputStatus, stepsOverlapAssumptions } from '../model/activity';
import { MUSCLE_MODEL_ASSUMPTIONS, growthScenarioFor, muscleOutputStatus, type MuscleK, type MuscleState } from '../model/muscle';
import { INTAKE_ASSUMPTIONS, intakeTimingDomain } from '../model/intake';
import { buildModelParams, drawKindOf, param, sampleParams, withOverrides } from './paramsRegistry';
import { Recorder } from './recorder';
import { DayHourTable, compileSchedule, expandDayToHours, habitualWeek, loadHour, newHourInput, resolveDayInPlace, writeDayExposure } from './compileSchedule';
import { resolveProfile } from './resolveProfile';
import { DEFAULTS, ENGINE_VERSION, RHO } from './defaults';
import { fnv1a, wakeRecordHour } from './math';
import { MAX_UNROLLED, recordHourAll, stepHourAll } from './dispatch';
import { computeConstraintMargins, computeWarningMargins } from '../model/safety/constraints';
// living plan (CR-L1 day-stamped snapshots, CR-L2 anchors, CR-L3 intake offset; docs/LIVING_PLAN.md)
import { captureDayMask, captureDaySnapshot, daySnapshotKey, incompatibleTracePrefix, restoreTracePrefix } from './snapshot';
import { ensembleBands, memberEnvelope } from './bands';
import { applyTissueAnchor, intakeOffsetArray, newOffsetScratch, offsetDayIntake, type AnchorBusView } from '../assimilation/runHooks';

/** Allocation-free event buffer. */
class EventBuffer implements EventSink {
  private readonly type: Int16Array;
  private readonly hour: Int32Array;
  private readonly value: Float64Array;
  private n = 0;
  enabled = true;
  constructor(readonly capacity: number) {
    this.type = new Int16Array(capacity);
    this.hour = new Int32Array(capacity);
    this.value = new Float64Array(capacity);
  }
  emit(type: SimEventType, hourIndex: number, value: number): void {
    if (!this.enabled || this.n >= this.capacity || hourIndex < 0) return;
    this.type[this.n] = EVENT_CODE[type];
    this.hour[this.n] = hourIndex;
    this.value[this.n] = value;
    this.n++;
  }
  toArray(): SimEvent[] {
    const out: SimEvent[] = [];
    for (let i = 0; i < this.n; i++) {
      const h = this.hour[i]!;
      out.push({ type: EVENT_TYPES[this.type[i]!]!, hour: h, day: Math.floor(h / 24), value: this.value[i]! });
    }
    return out;
  }
}

/**
 * The run's SafetyTrace (17 §2.1): every field, the optional ones included, allocated NaN-filled for the horizon, so the
 * safety module, early-abort bounds and day-stamped snapshots always see one layout (`Required` makes the compiler reject
 * a trace field the core does not allocate). NaN = not written (unknown), never zero exposure.
 *
 * D4-04 (calendar energy availability, trace-only: no bus signal, no series): `eatingDayEa7` is the legacy eating-day
 * statistic `ea7` (non-fast-day mean of clipped samples) under its explicit name — the same array, so the alias can never
 * diverge from it; the daily exposure ledger (`eiKcal` ME intake, `eeeNetKcal` net session exercise above rest, `ffmActKg`
 * at the daily sample, unclipped `eaRawDaily`), the calendar `calendarEa7`/`calendarEa28` = Σ(EI − EEE_net)/Σ FFM_act over
 * the independently covered days of the window and their day counts `eaCoverage7`/`eaCoverage28` are written by safety.
 * Intake/exercise coverage and exercise-scope sidecars distinguish observed actual days, covered sessions and prescribed scenarios.
 * `fatMassKg` (D4-05) is the end-of-day fat mass for the tissue fat fraction.
 */
function newSafetyTrace(nDays: number): Required<SafetyTrace> {
  const f = () => new Float32Array(nDays).fill(Number.NaN);
  const ea7 = f();
  return {
    ei7: f(), tdee7: f(), deficitPct7: f(), ea7, tissueMassKg: f(), rate14KgPerWk: f(), rate14PctPerWk: f(),
    cumLossPct: f(), bmi: f(), bodyFatPct: f(), fastHMax: f(), fastH7: f(), proteinGPerKgRw: f(), fatPctEnergy: f(), hungerIdx: f(),
    eee7: f(), fastDay: f(), ei28: f(), fastH7Cap: f(), deficitPct28: f(),
    eatingDayEa7: ea7, calendarEa7: f(), calendarEa28: f(), eaCoverage7: f(), eaCoverage28: f(),
    eiKcal: f(), eeeNetKcal: f(), ffmActKg: f(), eaRawDaily: f(), fatMassKg: f(),
    eaIntakeCoverage: f(), eaExerciseCoverage: f(), eaExerciseScope: f(),
  };
}

/** Every SafetyTrace quantity the core allocates, in allocation order (valid `abortOn` trace bounds; D4-04 included). */
export const SAFETY_TRACE_KEYS: readonly SafetyTraceKey[] = Object.freeze(Object.keys(newSafetyTrace(0)) as SafetyTraceKey[]);

const RMR_DEV_ID = 'energy.rmrIndividualFrac';

/**
 * D1-08: tolerance of the hourly tissue-ledger identity (kcal per hour) above which an hour is a numerical-limit crossing.
 * Conserving hours close to ≤ 1e-6 kcal (validation suite); a floor that clips a tissue flux breaks the identity by the
 * clipped energy. A numerical guard, not a physiological threshold.
 */
const LEDGER_LIMIT_TOL_KCAL = 1e-3;
/** Version of the domain-validity record (D1-08). */
const VALIDITY_VERSION = 1;
/** D1-08: signals of the hourly tissue-ledger identity (energy fluxes and the two tissue masses). */
const LEDGER_SIGNALS = ['eAbsKcalH', 'teePreKcalH', 'dnlHeatKcalH', 'ketoneLossKcalH', 'glycogenChangeKcalH', 'fatMassKg', 'leanTissueKg'] as const;
/**
 * D1-08: the ledger guard applies only when every term of the identity is written by a running module (a scripted or
 * partial module set leaves some fluxes at their bus defaults, so the identity is undefined there, not violated).
 */
function ledgerGuardApplies(modules: readonly AnyEngineModule[]): boolean {
  return LEDGER_SIGNALS.every((sig) => modules.some((m) => (m.writes as readonly string[]).includes(sig)));
}

/**
 * The person behind an ensemble draw whose RMR deviates from the prediction equation by δ (energy.rmrIndividualFrac):
 * RMR0·(1 + δ); a weight-stable person eats their true maintenance, TDEE0 + δ·RMR0, so the habitual carbohydrate, fibre
 * and fat grams scale with it (protein too unless it was entered per kg). Body composition and habits are unchanged.
 */
export function withRmrDeviation(p: ResolvedProfile, delta: number): ResolvedProfile {
  const dRmr = delta * p.rmr0Kcal;
  const tdee = p.tdee0Kcal + dRmr;
  const f = p.tdee0Kcal > 0 ? tdee / p.tdee0Kcal : 1;
  const protein = Number.isFinite(p.habits.habitualProteinGPerKg) ? p.habitualProteinG : p.habitualProteinG * f;
  const carb = p.habitualCarbG * f;
  const fibre = p.habitualFibreG * f;
  const alcKcal = (7 * p.habits.habitualAlcoholDrinksPerWeek * DEFAULTS.gramsPerDrink) / 7;
  const fat = Math.max(0, (tdee - 4 * protein - 4 * carb - 2 * fibre - alcKcal) / 9);
  return { ...p, rmr0Kcal: p.rmr0Kcal + dRmr, tdee0Kcal: tdee, habitualProteinG: protein, habitualCarbG: carb, habitualFibreG: fibre, habitualFatG: fat };
}

function optParam(ctx: ModuleContext, id: string, fallback: number): number {
  return ctx.params.index.has(id) ? param(ctx.params, id) : fallback;
}

/** Realised inputs echoed as series (owner 'core', MODEL_SPEC §6.3). Allocation-free. */
function recordInputs(day: DayInput, bus: SignalBus, out: Float64Array): void {
  out[MI.inEnergy] = day.energyKcal;
  // R-MAINT: every compiled day carries its maintenance reference at the planned activity (hand-built days may not)
  const maint = Number.isFinite(day.maintenanceKcal) ? day.maintenanceKcal : bus.maintenanceKcalD;
  out[MI.inEnergyPctMaint] = maint > 0 ? (100 * day.energyKcal) / maint : Number.NaN;
  out[MI.inMaintRef] = maint;
  out[MI.inBalancePlanned] = day.energyKcal - maint;
  out[MI.inProtein] = day.proteinG;
  out[MI.inCarbs] = day.carbG;
  out[MI.inFat] = day.fatG;
  out[MI.inFibre] = day.fibreG;
  out[MI.inAlcohol] = day.alcoholG;
  out[MI.inSteps] = day.steps;
  let sets = 0;
  let cardio = 0;
  for (let i = 0; i < day.nSessions; i++) {
    const s = day.sessions[i]!;
    if (s.kind === 'resistance') for (let k = 0; k < s.setsByRegion.length; k++) sets += s.setsByRegion[k]!;
    else cardio += s.durationMin;
  }
  out[MI.inRtSets] = sets;
  out[MI.inCardioMin] = cardio;
  out[MI.inSleep] = day.sleepHours;
}

/** D7-02: the lab field behind each absolutely anchored series (the exact accepted value is read from it, never re-derived). */
const LAB_FIELD_OF: Readonly<Partial<Record<SeriesId, keyof LabBaselines>>> = {
  ldl: 'ldlMmolL',
  hdl: 'hdlMmolL',
  triglycerides: 'tgMmolL',
  apoB: 'apoBgL',
  fastingGlucose: 'fastingGlucoseMmolL',
  sbp: 'sbpMmHg',
  liverFat: 'liverFatPct',
};

/**
 * D7-02, consumer of the cardiometabolic module's provider (`cardiometabolicObservedAnchors`): the accepted measured labs
 * of the run, the calibration domain each is judged against (liver fat with the run's `liver.min/max`) and the resulting
 * out-of-domain statuses, direct and through the module's derived dependencies (ApoB from LDL/TG, S_I from FPG). A1-052:
 * they apply from daily index 0 — the first end-of-day sample is already a response to day 1; only the t = 0 value
 * (`initial`, `meta.observedAnchors`) is the observation. A value whose provenance says `generated` is a prior, never an
 * observation. Null when the run has no cardiometabolic module or no accepted lab.
 */
function observedLabBaselines(
  profile: ResolvedProfile,
  params: ModelParams,
  modules: readonly AnyEngineModule[],
): { labs: LabBaselines; provider: ReturnType<typeof cardiometabolicObservedAnchors> } | null {
  const labs = profile.input.labs;
  if (!labs || !modules.some((m) => m.id === 'cardiometabolic')) return null;
  const meta = profile.input.labMeta;
  const accepted: Record<string, number> = {};
  let any = false;
  for (const [k, v] of Object.entries(labs) as Array<[keyof LabBaselines, number | undefined]>) {
    if (v === undefined || meta?.[k]?.source === 'generated') continue;
    accepted[k] = v;
    any = true;
  }
  if (!any) return null;
  const lo = params.index.get('cardiometabolic.liver.min');
  const hi = params.index.get('cardiometabolic.liver.max');
  const liver = lo !== undefined && hi !== undefined ? { lo: params.values[lo]!, hi: params.values[hi]! } : CARDIOMETABOLIC_DOMAIN.liverFat;
  return { labs: accepted as LabBaselines, provider: cardiometabolicObservedAnchors(accepted as LabBaselines, liver) };
}

/**
 * D7-02: anchor the recorded t = 0 value of every enabled lab series to the accepted measured value exactly, and put the
 * provider's out-of-domain statuses on the recorder (every series, requested or not, so dependants close over them). A
 * value flagged out of domain by its provenance, or one the module did not reproduce at t = 0 (it clamped), is out of
 * domain too: the measurement still stands at t = 0, the later values are compatibility numbers whose status forbids
 * reading them as a forecast. A day-stamped continuation re-applies the anchors its snapshot carries (its first frame is
 * day k, not t = 0) with the same statuses. A1-052: every status set here applies from daily index 0 (zero-based daily
 * convention: index 0 is the end of day 1, a modelled response; hourly consumers mask every t > 0 sample), whatever day
 * the provider stamps; the exact anchor value itself is untouched. Returns the anchors for `meta.observedAnchors`.
 */
function applyObservedAnchors(
  profile: ResolvedProfile,
  params: ModelParams,
  modules: readonly AnyEngineModule[],
  recorder: Recorder,
  enabled: Uint8Array,
  stored?: readonly ObservedAnchor[],
): ObservedAnchor[] {
  const obs = observedLabBaselines(profile, params, modules);
  if (obs) for (const [id, st] of Object.entries(obs.provider.outputStatus) as Array<[SeriesId, SeriesStatusMeta]>) recorder.setStatus(SERIES_INDEX[id], { ...st, fromDay: 0 });
  const flag = (i: number, reasonCode: string) => recorder.setStatus(i, { status: 'outOfDomain', reasonCode, fromDay: 0 });
  const out: ObservedAnchor[] = [];
  if (stored) {
    for (const a of stored) {
      const i = SERIES_INDEX[a.series];
      if (enabled[i] !== 1 || !recorder.anchorInitial(i, a.value)) continue;
      if (a.outOfDomain) flag(i, 'measuredBaselineOutsideModelDomain');
      out.push({ ...a });
    }
    return out;
  }
  if (!obs) return out;
  const meta = profile.input.labMeta;
  for (const a of obs.provider.anchors) {
    const field = LAB_FIELD_OF[a.series];
    const raw = field ? obs.labs[field] : undefined;
    const i = SERIES_INDEX[a.series];
    if (field === undefined || raw === undefined || enabled[i] !== 1) continue;
    const m = meta?.[field];
    const model = recorder.initial[i]!;
    const reproduced = Number.isFinite(model) && Math.abs(model - raw) <= 1e-9 * Math.max(1, Math.abs(raw));
    const outOfDomain = a.outOfDomain || m?.outOfDomain === true || !reproduced;
    recorder.anchorInitial(i, raw);
    if (outOfDomain && !a.outOfDomain) flag(i, m?.outOfDomain === true ? 'measuredBaselineFlaggedOutOfDomain' : 'measuredBaselineNotReproduced');
    out.push({ series: a.series, value: raw, unit: a.unit, ...(m?.sampleId ? { observationId: m.sampleId } : {}), outOfDomain });
  }
  return out;
}

/** Named approximations a module brings into every run (D2-01: SimulationMeta.assumptions; activity/muscle W1 C6). */
const MODULE_ASSUMPTIONS: Readonly<Partial<Record<string, readonly string[]>>> = {
  fasting: ['legacyRollingIntakeRouting'],
  activity: ACTIVITY_MODEL_ASSUMPTIONS,
  muscle: MUSCLE_MODEL_ASSUMPTIONS,
};

/** Whether a module instance carries the state/constant fields a provider reads (stub and test modules do not). */
const hasKeys = (o: unknown, keys: readonly string[]): boolean => o !== null && typeof o === 'object' && keys.every((k) => k in (o as object));

/** Composition's per-hour model-limit flag (D1-08), when the run has the real composition state; null otherwise. */
function compIdx0(modules: readonly AnyEngineModule[], S: readonly object[]): { readonly limitThisHour: number } | null {
  const i = modules.findIndex((m) => m.id === 'composition');
  return i >= 0 && hasKeys(S[i], ['limitThisHour']) ? (S[i] as { limitThisHour: number }) : null;
}

/**
 * C6 run statuses the modules derive from their final state (W1 providers: composition partition domains and tissue floor,
 * D1-05/D1-08; cardiometabolic response validity, D7-06…D7-09; wellbeing exploratory outputs, D8-04/D8-05; A1-041: the
 * activity module's fitness-response scenario (VO2max) and the muscle module's exploratory MPS index and scenario lean/
 * strength labelled by the run's actual growth state), put on the recorder (worst status wins, so a stronger status already
 * set stays) whatever series are requested, so dependants close over them. Stub/test modules without the provider's state
 * are skipped. Allocation allowed (finalize).
 */
function applyModuleStatuses(modules: readonly AnyEngineModule[], S: readonly object[], K: readonly object[], recorder: Recorder): void {
  for (let i = 0; i < modules.length; i++) {
    const id = modules[i]!.id;
    if (id === 'composition' && hasKeys(S[i], ['lowProteinSurplusFromDay', 'unknownProteinSurplusFromDay', 'vliFromDay', 'modelLimitHour', 'modelLimitKind'])) {
      for (const r of compositionOutputStatuses(S[i] as CompositionState)) {
        const { series, ...meta } = r;
        for (const sid of series) recorder.setStatus(SERIES_INDEX[sid], meta);
      }
    } else if (id === 'cardiometabolic' && hasKeys(S[i], ['ketoFromDay']) && hasKeys(K[i], ['lemEnabled', 'liverKetoScenario', 'liverMeasured', 'hepCalibrated', 'glucoseLoweringContext', 'outOfDomain'])) {
      const st = cardiometabolicRunStatus(S[i] as CardiometabolicState, K[i] as CardiometabolicK);
      for (const [sid, meta] of Object.entries(st) as Array<[SeriesId, SeriesStatusMeta]>) recorder.setStatus(SERIES_INDEX[sid], meta);
    } else if (id === 'wellbeing' && hasKeys(S[i], ['eaRawStatus'])) {
      const st = wellbeingOutputStatus(S[i] as WellbeingState);
      for (const [sid, meta] of Object.entries(st) as Array<[SeriesId, SeriesStatusMeta]>) if (sid in SERIES_INDEX) recorder.setStatus(SERIES_INDEX[sid], meta);
    } else if (id === 'activity' && hasKeys(S[i], ['vo2max', 'vo2FastPool', 'vo2SlowPool'])) {
      const st = activityOutputStatus();
      for (const [sid, meta] of Object.entries(st) as Array<[SeriesId, SeriesStatusMeta]>) if (sid in SERIES_INDEX) recorder.setStatus(SERIES_INDEX[sid], meta);
    } else if (id === 'muscle' && hasKeys(S[i], ['growthState', 'growthScenario'])) {
      const st = muscleOutputStatus(S[i] as MuscleState);
      for (const [sid, meta] of Object.entries(st) as Array<[SeriesId, SeriesStatusMeta]>) if (sid in SERIES_INDEX) recorder.setStatus(SERIES_INDEX[sid], meta);
    }
  }
}

/**
 * D6-07/D6-08/C6: the intake module's named assumptions in force (`INTAKE_ASSUMPTIONS`), each from the first day it
 * applies over the whole horizon (a resumed run reports the same): during-session carbohydrate of unknown mixture routed
 * as glucose; fibre energy without a justified hourly kernel; the generic fibre/nut ME scenarios when switched on. Their
 * direct series get the declared status from that day. Allocation allowed (finalize).
 */
function applyIntakeAssumptions(compiled: CompiledSchedule, params: ModelParams, recorder: Recorder, profile?: ResolvedProfile): string[] {
  const on = (id: string): boolean => params.index.has(id) && param(params, id) >= 0.5;
  const first = (pred: (d: DayInput) => boolean): number => {
    for (let d = 0; d < compiled.days.length; d++) if (pred(compiled.days[d]!)) return d;
    return -1;
  };
  const unknownMix = (d: DayInput): boolean => {
    if (d.zeroIntake) return false;
    for (let i = 0; i < d.nSessions; i++) {
      const s = d.sessions[i]!;
      if (s.carbDuringGPerH > 0 && s.durationMin > 0 && s.carbDuringFructoseShare === undefined) return true;
    }
    return false;
  };
  const from: Record<keyof typeof INTAKE_ASSUMPTIONS, number> = {
    unknownCarbMixtureAsGlucose: first(unknownMix),
    fibreEnergyHourlyTiming: first((d) => d.fibreG > 0),
    fibreMeScenario: on('intake.fibreMeScenario') ? first((d) => d.fibreG > 0) : -1,
    nutMeScenario: on('intake.nutMeScenario') ? first((d) => d.nutsG > 0) : -1,
  };
  const out: string[] = [];
  for (const key of Object.keys(INTAKE_ASSUMPTIONS) as Array<keyof typeof INTAKE_ASSUMPTIONS>) {
    const d0 = from[key];
    if (d0 < 0) continue;
    out.push(key);
    const a = INTAKE_ASSUMPTIONS[key];
    for (const id of a.series as readonly SeriesId[]) recorder.setStatus(SERIES_INDEX[id], { status: 'scenario', reasonCode: a.reasonCode, uncertaintyKind: a.uncertaintyKind, fromDay: d0 });
  }
  // D6-07: a known disease/medication context (GLP-1 medication, gastroparesis, bariatric surgery, IBD) puts the hourly
  // appearance kernels out of domain — a status on the hourly appearance-driven series only, never a multiplier; daily
  // energy stays usable
  if (profile) {
    const timing = intakeTimingDomain({ diabetesMedication: profile.safety.flags.diabetesMedication, medications: profile.input.medications }, compiled.startDate);
    if (timing.status === 'outOfDomain') for (const id of INTAKE_TIMING_SERIES) recorder.setStatus(SERIES_INDEX[id], { status: 'outOfDomain', reasonCode: `intakeTiming:${timing.reasons[0]!}` });
  }
  return out;
}

/** Series driven by the hourly appearance kernels (D6-07 timing domain). */
const INTAKE_TIMING_SERIES: readonly SeriesId[] = ['glucose', 'insulin'];

/**
 * D6-02/C6: the energy module's named intake assumptions (`ENERGY_INTAKE_ASSUMPTIONS`) in force in this run — energy-only
 * intake at the habitual TEF mix, a partial protein total as a lower bound — each from the first day it applies (over the
 * whole horizon, so a resumed run reports the same). Their series carry a scenario status from that day; ids are returned
 * for `SimulationMeta.assumptions`. Allocation allowed (finalize).
 */
function applyEnergyIntakeAssumptions(compiled: CompiledSchedule, recorder: Recorder): string[] {
  const out: string[] = [];
  for (const key of Object.keys(ENERGY_INTAKE_ASSUMPTIONS) as Array<keyof typeof ENERGY_INTAKE_ASSUMPTIONS>) {
    let from = -1;
    for (let d = 0; d < compiled.days.length && from < 0; d++) {
      const day = compiled.days[d]!;
      if (key === 'unallocatedEnergyHabitualTefMix' ? (day.unallocatedKcal ?? 0) > 0 : proteinIsLowerBound(day)) from = d;
    }
    if (from < 0) continue;
    out.push(key);
    const a = ENERGY_INTAKE_ASSUMPTIONS[key];
    for (const id of a.series) recorder.setStatus(SERIES_INDEX[id], { status: 'scenario', reasonCode: a.reasonCode, uncertaintyKind: a.uncertaintyKind, fromDay: from });
  }
  return out;
}

/** One named input assumption with its structured detail (`SimulationMeta.assumptionDetails`). */
export interface AssumptionDetail {
  id: string;
  fromDay?: number;
  affects?: readonly SeriesId[];
  reasonCode: string;
  scenario?: string;
}

/** Substrate pools, fuel, water and TEF: outputs that need the macronutrient allocation of the energy eaten (A1-013). */
const SUBSTRATE_SERIES: readonly SeriesId[] = [
  'glucose', 'insulin', 'glycogenTotal', 'liverGlycogen', 'muscleGlycogen', 'glycogenWater', 'bhb', 'totalKetones', 'ketosisState',
  'hoursInKetosis', 'ketoAdaptation', 'ketoAdaptFast', 'ketoAdaptSlow', 'ketoInduction', 'fatOxidation', 'choOxidation', 'dnl', 'tef',
  'waterWeight', 'ecfShift',
];
/** Tissue partition and its direct derivatives (main, regional, nitrogen; A1-013). */
const TISSUE_SERIES: readonly SeriesId[] = [
  'fatMass', 'leanTissue', 'leanMass', 'skeletalMuscle', 'scaleWeight', 'bodyFatPct', 'waist', 'visceralFat', 'fatTrunk', 'fatArms',
  'fatLegs', 'muscleArms', 'muscleLegs', 'muscleTrunk', 'nitrogenBalance',
];
/** Protein turnover, MPS-derived and amino-acid-driven outputs (A1-013: unknown protein, never zero protein). */
const PROTEIN_SERIES: readonly SeriesId[] = ['mps', 'mtorIdx', 'fastProteinCost', 'rtMuscleGain', 'insulin', 'glucose'];
/** Markers downstream of the tissue/substrate state (a review status does not travel through the closure, C6). */
const MARKER_SERIES: readonly SeriesId[] = ['liverFat', 'ldl', 'apoB', 'triglycerides', 'insulinSensitivity', 'fastingGlucose', 'sbp', 'crp', 'leptin'];
/** Glucose/insulin/fuel/ketone outputs a polyol's unmodelled substrate route can move (A1-031). */
const POLYOL_SERIES: readonly SeriesId[] = [
  'glucose', 'insulin', 'glycogenTotal', 'liverGlycogen', 'muscleGlycogen', 'glycogenWater', 'bhb', 'totalKetones', 'ketosisState',
  'hoursInKetosis', 'ketoInduction', 'fatOxidation', 'choOxidation', 'dnl',
];
/** Muscle growth/retention/strength and the lean tissue the training stimulus partitions (A1-022). */
const MUSCLE_DOSE_SERIES: readonly SeriesId[] = ['rtMuscleGain', 'strength', 'skeletalMuscle', 'muscleArms', 'muscleLegs', 'muscleTrunk', 'leanTissue', 'mps'];

const NON_PROTEIN_BITS = NUTRIENT_UNKNOWN_BIT.carbohydrate | NUTRIENT_UNKNOWN_BIT.fat | NUTRIENT_UNKNOWN_BIT.fibre | NUTRIENT_UNKNOWN_BIT.ethanol;

/** Whether a compiled day carries polyols (A1-031). */
function dayHasPolyols(d: DayInput): boolean {
  const p = d.polyolsG;
  if (!p) return false;
  for (const k in p) if (p[k]! > 0) return true;
  return false;
}

/** Whether a compiled day steps resistance sets whose hard-set count is unknown (A1-022). */
function dayHasUnknownDose(d: DayInput): boolean {
  const n = d.rtGroups !== undefined ? Math.min(d.nRtGroups ?? 0, d.rtGroups.length) : 0;
  for (let g = 0; g < n; g++) if ((d.rtGroups![g]!.setsUnknown ?? 0) > 0 && d.rtGroups![g]!.sets > 0) return true;
  for (let i = 0; i < d.nSessions; i++) {
    const s = d.sessions[i]!;
    if (s.kind === 'resistance' && s.doseStatus === 'unknown' && s.durationMin > 0) return true;
  }
  return false;
}

/**
 * The input dependency statuses of a run (A1-013, A1-022, A1-025, A1-031): each named unknown of the compiled inputs puts its
 * status on every output whose equations need it — from the first day it applies over the whole horizon (a resumed run or a
 * one-series mask reports the same first day and reason), independent of the energy-balance sign — and is listed by id.
 *  - `unknownMacroAllocation` (scenario): reported energy beyond the known grams with an unknown non-protein macronutrient:
 *    substrate pools, fuel, ketones, water, TEF and the tissue partition depend on an allocation the record does not give
 *    (the run computes them under the named energy-only scenario; the known intake totals stay known).
 *  - `unknownProteinAllocation` (scenario): the same with unknown protein: protein turnover, MPS-derived and amino-acid-
 *    driven outputs and the partition (missing protein is never zero or deficient protein).
 *  - `reportedEnergyConflict` (review): known grams exceed the reported energy beyond rounding; the reported energy is kept
 *    (A1-025), so the allocation-dependent substrate, TEF, tissue and marker outputs await review even though no positive
 *    energy is unallocated.
 *  - `polyolRouteUnmodelled` (scenario): polyols without a substrate route; glucose/insulin/fuel/ketone outputs are the
 *    named zero-route scenario, not a resolved zero response.
 *  - `unknownHardSetCount` (scenario, `legacyMinuteConversion`): resistance sets whose count is unknown; muscle growth,
 *    retention, strength and the lean partition are conditional on the named minute conversion (energy outputs stay).
 * Applied earliest day first (the recorder keeps the first of equal statuses). No coefficient, no allocation of unknown
 * energy. Allocation allowed (finalize).
 */
function applyInputDependencyStatuses(compiled: CompiledSchedule, modules: readonly AnyEngineModule[], recorder: Recorder): AssumptionDetail[] {
  const has = (id: string): boolean => modules.some((m) => m.id === id);
  const intake = has('energy') || has('intake');
  const first = (pred: (d: DayInput) => boolean): number => {
    for (let d = 0; d < compiled.days.length; d++) if (pred(compiled.days[d]!)) return d;
    return -1;
  };
  const seeds: Array<AssumptionDetail & { status: OutputStatus; uncertaintyKind: UncertaintyKind; series: readonly SeriesId[] }> = [];
  const add = (id: string, from: number, status: OutputStatus, series: readonly SeriesId[], scenario?: string): void => {
    if (from < 0) return;
    seeds.push({ id, fromDay: from, reasonCode: id, status, uncertaintyKind: 'scenario', series, ...(scenario ? { scenario } : {}) });
  };
  if (intake) {
    const unallocated = (d: DayInput): boolean => !d.zeroIntake && (d.unallocatedKcal ?? 0) > 0;
    add('unknownMacroAllocation', first((d) => unallocated(d) && ((d.nutrientUnknownMask ?? 0) & NON_PROTEIN_BITS) !== 0), 'scenario', [...SUBSTRATE_SERIES, ...TISSUE_SERIES], 'energyOnlyNoSubstrateRoute');
    add('unknownProteinAllocation', first((d) => unallocated(d) && ((d.nutrientUnknownMask ?? 0) & NUTRIENT_UNKNOWN_BIT.protein) !== 0), 'scenario', [...PROTEIN_SERIES, ...TISSUE_SERIES], 'proteinLowerBound');
    add('reportedEnergyConflict', first((d) => !d.zeroIntake && d.energyStatus === 'conflict'), 'review', [...SUBSTRATE_SERIES, ...TISSUE_SERIES, ...MARKER_SERIES], 'reportedEnergyKept');
    add('polyolRouteUnmodelled', first((d) => !d.zeroIntake && dayHasPolyols(d)), 'scenario', POLYOL_SERIES, 'polyolZeroRoute');
  }
  if (has('muscle')) add('unknownHardSetCount', first(dayHasUnknownDose), 'scenario', MUSCLE_DOSE_SERIES, 'legacyMinuteConversion');
  seeds.sort((a, b) => (a.fromDay ?? 0) - (b.fromDay ?? 0));
  const out: AssumptionDetail[] = [];
  for (const sd of seeds) {
    const affects = [...new Set(sd.series)].filter((id) => id in SERIES_INDEX);
    for (const id of affects) recorder.setStatus(SERIES_INDEX[id], { status: sd.status, reasonCode: sd.reasonCode, uncertaintyKind: sd.uncertaintyKind, fromDay: sd.fromDay });
    out.push({ id: sd.id, fromDay: sd.fromDay, affects, reasonCode: sd.reasonCode, ...(sd.scenario ? { scenario: sd.scenario } : {}) });
  }
  return out;
}

/**
 * A1-040: both operands of the step ledger — the current days and the habitual reference — disclose an unresolved
 * step/session overlap (`stepsOverlapUnknown`, `habitualStepsOverlapUnknown`: nothing subtracted, a named no-subtraction
 * scenario), the reference even when every current day's overlap is known. Depends on the compiled days and the profile
 * only (full or subset masks and resumed runs report the same). Allocation allowed (finalize).
 */
function stepsOverlapDetails(compiled: CompiledSchedule, profile: ResolvedProfile, modules: readonly AnyEngineModule[]): AssumptionDetail[] {
  if (!modules.some((m) => m.id === 'activity')) return [];
  const disc = stepsOverlapAssumptions(compiled.days, profile);
  return disc.assumptions.map((id) => ({ id, reasonCode: id, scenario: 'noSubtraction' }));
}

/** C2/D2-01: weakest causal resolution of the compiled days that carry one (replayed observed days), or undefined. */
function runResolution(compiled: CompiledSchedule): CausalResolution | undefined {
  let r: CausalResolution | undefined;
  for (const d of compiled.days) if (d.resolution !== undefined) r = r === undefined ? d.resolution : weakestResolution(r, d.resolution);
  return r;
}

/**
 * D4-03/C5: fingerprint of everything that shapes a run's initial state and history — engine/registry/contract versions,
 * the parameter vector, the profile input, the module list, start date, burn-in, the realised-history hash of the schedule
 * and the restored snapshot, if any. Certificates bind it (`CertificateInputs.initialStateHash`); a change forces
 * revalidation. Pure; allocation allowed.
 */
export function initialStateFingerprint(
  profile: ResolvedProfile,
  compiled: CompiledSchedule,
  options: RunOptions = {},
  modules: readonly AnyEngineModule[] = MODULES,
): string {
  const params = effectiveParams(buildModelParams(modules), options);
  const values = params.values;
  return contentHash({
    engine: ENGINE_VERSION,
    registry: params.registryHash,
    contracts: CONTRACT_FINGERPRINT,
    params: Array.from(values),
    profile: profile.input,
    modules: modules.map((m) => m.id),
    startDate: compiled.startDate,
    mode: options.mode ?? 'simulate',
    burnInDays: Math.max(0, Math.floor(options.burnInDays ?? 14)),
    history: compiled.realised?.historyHash ?? null,
    snapshot: options.initialSnapshot?.key ?? null,
  });
}

/**
 * The parameter vector a run uses: the registry (or the caller's full override vector) with the explicitly selected
 * structural modes applied (A1-065: `RunOptions.structuralModes`, id → value). A mode may only select a parameter whose draw
 * kind is fixed (a structural/research switch); a stochastic parameter or an unknown id is refused, never silently
 * ignored. Pure.
 */
export function effectiveParams(base: ModelParams, options: Pick<RunOptions, 'paramOverrides' | 'structuralModes'>): ModelParams {
  const p = options.paramOverrides ? withOverrides(base, options.paramOverrides) : base;
  const modes = options.structuralModes;
  if (!modes) return p;
  const ids = Object.keys(modes);
  if (ids.length === 0) return p;
  const values = Float64Array.from(p.values);
  for (const id of ids) {
    const i = base.index.get(id);
    if (i === undefined) throw new Error(`structuralModes: unknown parameter "${id}"`);
    if (drawKindOf(base.defs[i]!) !== 'fixed') throw new Error(`structuralModes: "${id}" is sampled in ensembles, not a structural mode`);
    const v = modes[id]!;
    if (!Number.isFinite(v)) throw new Error(`structuralModes: "${id}" needs a finite value`);
    values[i] = v;
  }
  return withOverrides(base, values);
}

/**
 * A1-065: the member parameter vectors of an ensemble — the seeded Latin hypercube of the registry, with every parameter
 * whose draw kind is FIXED taking the caller's value when an explicit full override vector is given (a selected structural
 * switch or research value holds in every member, as in the nominal run). Stochastic parameters keep their declared
 * sampling law (an override of a stochastic value never pins it). Direct (`simulateEnsemble`) and streamed
 * (`simulateDrawChunk`) ensembles use this one function, so the same seed/count give the same members. Pure.
 */
export function ensembleMemberVectors(defs: readonly ParamDef[], spec: { count: number; seed: number }, overrides?: Float64Array): Float64Array[] {
  const vectors = sampleParams(defs, spec);
  if (!overrides) return vectors;
  if (overrides.length !== defs.length) throw new Error(`paramOverrides length ${overrides.length} ≠ registry length ${defs.length}`);
  for (let i = 0; i < defs.length; i++) {
    if (drawKindOf(defs[i]!) !== 'fixed') continue;
    const v = overrides[i]!;
    for (const m of vectors) m[i] = v;
  }
  return vectors;
}

/** Hourly (resp. daily) record hooks are needed only for modules that own at least one enabled series of that resolution. */
function recordersNeeded(modules: readonly AnyEngineModule[], enabled: Uint8Array, resolution: 'hourly' | 'daily'): boolean[] {
  return modules.map((m) => m.records.some((id) => enabled[SERIES_INDEX[id]] === 1 && seriesDef(id).resolution === resolution));
}

/**
 * Validity key of a snapshot (see `EngineSnapshot`): everything that shapes the post-burn-in state. The parameter vector
 * and the profile input are hashed; module list, start date, horizon, mode, series mask and burn-in length are explicit.
 */
function snapshotKey(profile: ResolvedProfile, compiled: CompiledSchedule, modules: readonly AnyEngineModule[], values: Float64Array, ctx: ModuleContext): string {
  let v = '';
  for (let i = 0; i < values.length; i++) v += `${values[i]},`;
  let mask = '';
  for (let i = 0; i < ctx.seriesEnabled.length; i++) mask += ctx.seriesEnabled[i]!;
  return [
    ENGINE_VERSION,
    ctx.params.registryHash,
    fnv1a(v),
    fnv1a(JSON.stringify(profile.input)),
    modules.map((m) => m.id).join(','),
    compiled.startDate,
    compiled.nDays,
    ctx.mode,
    fnv1a(mask),
    ctx.burnInDays ?? 0,
  ].join('|');
}

/**
 * Copy a snapshot state INTO a freshly initialised state object (same keys): typed arrays by `set`, nested plain objects
 * and arrays recursively, primitives by assignment. Restoring into `init()`'s own objects keeps the hidden classes the
 * modules' hot code is specialised on — a `structuredClone`d state is equal in value but ran ≈ 15 % slower (V8 builds
 * clones with different maps). Aliases created by `init` (e.g. composition's body.fat ↔ regional.fat) are preserved.
 */
function assignDeep(dst: Record<string, unknown>, src: Record<string, unknown>, prefix = false): void {
  for (const key of Object.keys(src)) {
    const v = src[key];
    const d = dst[key];
    if (ArrayBuffer.isView(v)) {
      const tv = v as unknown as Float64Array;
      const td = d as unknown as Float64Array | undefined;
      if (td && ArrayBuffer.isView(td) && td.constructor === tv.constructor && td.length === tv.length) td.set(tv);
      // day-stamped snapshots (CR-L1) restore into runs of another horizon: per-day arrays are copied as a prefix
      else if (prefix && td && ArrayBuffer.isView(td) && td.constructor === tv.constructor) td.set(tv.length <= td.length ? tv : tv.subarray(0, td.length));
      else dst[key] = tv.slice();
    } else if (Array.isArray(v)) {
      if (Array.isArray(d) && d.length === v.length) {
        for (let i = 0; i < v.length; i++) {
          const e = v[i] as unknown;
          if (e !== null && typeof e === 'object' && d[i] !== null && typeof d[i] === 'object') assignDeep(d[i] as Record<string, unknown>, e as Record<string, unknown>, prefix);
          else d[i] = structuredClone(e);
        }
      } else dst[key] = structuredClone(v);
    } else if (v !== null && typeof v === 'object') {
      if (d !== null && typeof d === 'object' && !ArrayBuffer.isView(d)) assignDeep(d as Record<string, unknown>, v as Record<string, unknown>, prefix);
      else dst[key] = structuredClone(v);
    } else {
      dst[key] = v;
    }
  }
}

/** Run one simulation with already-resolved inputs. */
export function runEngine(
  profile: ResolvedProfile,
  compiled: CompiledSchedule,
  options: RunOptions = {},
  modules: readonly AnyEngineModule[] = MODULES,
): SimulationResult {
  return run(profile, compiled, options, modules, false) as SimulationResult;
}

/**
 * Post-burn-in engine state for `RunOptions.initialSnapshot` (planner: once per person, parameter vector and horizon).
 * Runs prepare + init + burn-in + endBurnIn only; `compiled` supplies the start date and horizon of the runs that will
 * reuse the snapshot (its days are not simulated). Pass the same `mode`, `series` and `paramOverrides` as those runs.
 */
export function captureInitialSnapshot(
  profile: ResolvedProfile,
  compiled: CompiledSchedule,
  options: RunOptions = {},
  modules: readonly AnyEngineModule[] = MODULES,
): EngineSnapshot {
  return run(profile, compiled, { ...options, captureSnapshot: true, initialSnapshot: undefined }, modules, true) as EngineSnapshot;
}

function run(
  profile: ResolvedProfile,
  compiled: CompiledSchedule,
  options: RunOptions,
  modules: readonly AnyEngineModule[],
  stopAfterBurnIn: boolean,
): SimulationResult | EngineSnapshot {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const mode = options.mode ?? 'simulate';
  const record = options.record ?? (mode === 'planner' ? 'daily' : 'full');
  const nDays = compiled.nDays;
  const params = effectiveParams(buildModelParams(modules), options);
  // person-level RMR deviation (energy.rmrIndividualFrac, §8.1): the modules and the burn-in see the true person; the
  // compiled schedule keeps its prescriptions from the equation estimate. Nominal δ = 0 → the resolved profile itself.
  const rmrDev = params.index.has(RMR_DEV_ID) ? param(params, RMR_DEV_ID) : 0;
  const person = rmrDev === 0 ? profile : withRmrDeviation(profile, rmrDev);

  const seriesEnabled = new Uint8Array(N_SERIES);
  const seriesIds: SeriesId[] = [];
  if (options.series) {
    for (const id of options.series) {
      seriesEnabled[SERIES_INDEX[id]] = 1;
      seriesIds.push(id);
    }
  } else {
    seriesEnabled.fill(1);
    for (const d of SERIES) seriesIds.push(d.id);
  }
  // abortOn: series bounds must be recorded; SafetyTrace bounds are read from the trace (always filled by safety)
  const abortOn = options.abortOn ?? [];
  const nAbort = abortOn.length;
  const abortSeries = new Int32Array(nAbort).fill(-1);
  const abortTrace: (Float32Array | null)[] = new Array<Float32Array | null>(nAbort).fill(null);
  const abortLess = new Uint8Array(nAbort);
  const abortValue = new Float64Array(nAbort);

  const burnIn = Math.max(0, Math.floor(options.burnInDays ?? 14));
  const events = new EventBuffer(8192);
  events.enabled = options.collectEvents ?? true;
  const safetyTrace = newSafetyTrace(nDays);
  for (let b = 0; b < nAbort; b++) {
    const bound = abortOn[b]!;
    const si = (SERIES_INDEX as Record<string, number | undefined>)[bound.series];
    if (si !== undefined) {
      abortSeries[b] = si;
      seriesEnabled[si] = 1;
    } else if ((SAFETY_TRACE_KEYS as readonly string[]).includes(bound.series)) {
      abortTrace[b] = safetyTrace[bound.series as SafetyTraceKey] ?? null;
    } else {
      throw new Error(`abortOn: "${bound.series}" is neither a series nor a SafetyTrace quantity`);
    }
    abortLess[b] = bound.op === '<' ? 1 : 0;
    abortValue[b] = bound.value;
  }
  const ctx: ModuleContext = {
    profile: person,
    params,
    schedule: compiled,
    nDays,
    mode,
    seriesEnabled,
    events,
    checks: options.checks ?? false,
    safetyTrace,
    burnInDays: burnIn,
    abortOn,
  };

  // ---- prepare (always) & init or snapshot restore (allocation allowed)
  const nMod = modules.length;
  const K: object[] = new Array(nMod);
  const S: object[] = new Array(nMod);
  const bus: SignalBus = createSignalBus();
  for (let i = 0; i < nMod; i++) K[i] = modules[i]!.prepare(ctx);

  const recorder = new Recorder(nDays, record, seriesEnabled);
  const canonical = modules === MODULES && hasDefaultHourOrder(modules);
  const unrolled = nMod <= MAX_UNROLLED;
  const hour = newHourInput();
  const table = new DayHourTable();
  const clock: StepClock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
  // review V1a-L9: usual bed time equal to wake time is no sleep data; the defaults apply (as in compileSchedule)
  const noUsualSleep = (((profile.habits.wakeTimeH - profile.habits.bedTimeH) % 24) + 24) % 24 === 0;
  let prevBedH = noUsualSleep ? DEFAULTS.bedTimeH : profile.habits.bedTimeH;
  let prevSleepH = profile.habits.habitualSleepDurationH ?? (noUsualSleep ? (DEFAULTS.wakeTimeH - DEFAULTS.bedTimeH + 24) % 24 : (profile.habits.wakeTimeH - profile.habits.bedTimeH + 24) % 24);
  let t0WeightErr: number;
  let t0Scale: number;

  const snap = options.initialSnapshot;
  // CR-L1: a day-stamped snapshot (EngineSnapshot.day) starts the main loop at its day; absolute day/hour indices are kept
  const dayStamped = snap !== undefined && snap.day !== undefined;
  const restoreDay = dayStamped ? snap!.day! : 0;
  if (options.startDay !== undefined && options.startDay !== restoreDay) throw new Error(`startDay ${options.startDay} differs from the initial snapshot's day ${restoreDay}`);
  if (dayStamped && restoreDay >= nDays) throw new Error(`initialSnapshot day ${restoreDay} is outside this run's horizon (${nDays} days)`);
  if (dayStamped && options.captureSnapshot) throw new Error('captureSnapshot (post-burn-in state) cannot follow a day-stamped initialSnapshot; use captureSnapshotAt');
  const needKey = (snap !== undefined && !dayStamped) || options.captureSnapshot === true;
  const key = needKey ? snapshotKey(profile, compiled, modules, params.values, ctx) : '';
  if (snap) {
    // ---- restore the post-burn-in state (MODEL_SPEC §3.4 is skipped: it produced exactly this state) or a day-k state
    // C7: a snapshot captured under other contract semantics is never restored (its key also differs via the registry hash)
    if (snap.contracts !== undefined && snap.contracts !== CONTRACT_FINGERPRINT) throw new Error('initialSnapshot was captured under other contract versions; recompute it');
    const expected = dayStamped ? daySnapshotKey(profile, compiled.startDate, modules, params.values, ctx, restoreDay) : key;
    if (snap.key !== expected) throw new Error('initialSnapshot does not match this run (profile, parameters, modules, start date, horizon, mode, series or burn-in differ)');
    // C7/D4-04: a day-k state restores only with the whole trace history of days [0, k) (trailing calendar windows and the
    // run's constraint margins read it); a prefix that is missing or not a typed copy is never filled in with NaN
    if (dayStamped) {
      const bad = incompatibleTracePrefix(safetyTrace, snap, restoreDay);
      if (bad.length > 0) throw new Error(`initialSnapshot lacks the safety trace history of ${bad.join(', ')}; recompute it`);
    }
    // init (cheap) builds the state objects with their usual shapes, then the post-burn-in values are copied into them
    for (let i = 0; i < nMod; i++) {
      S[i] = modules[i]!.init(K[i]!, ctx, bus);
      assignDeep(S[i] as Record<string, unknown>, snap.states[i] as Record<string, unknown>, dayStamped);
    }
    const b = bus as unknown as Record<string, number>;
    for (let j = 0; j < SIGNAL_DEFS.length; j++) b[SIGNAL_DEFS[j]!.name] = snap.bus[j]!;
    prevBedH = snap.prevBedH;
    prevSleepH = snap.prevSleepH;
    t0WeightErr = snap.t0WeightErrKg;
    t0Scale = profile.weightKg + snap.t0WeightErrKg;
  } else {
    for (let i = 0; i < nMod; i++) S[i] = modules[i]!.init(K[i]!, ctx, bus);

    // ---- burn-in on the habitual week (MODEL_SPEC §3.4, review B3): no recording, no events
    if (burnIn > 0) {
      const week: DayInput[] = habitualWeek(person);
      const wasEnabled = events.enabled;
      events.enabled = false;
      let prevHab: DayInput | null = null;
      for (let b = 0; b < burnIn; b++) {
        clock.day = b - burnIn;
        clock.weekday = (((profile.startWeekday + clock.day) % 7) + 7) % 7;
        const hab = week[clock.weekday]!;
        expandDayToHours(hab, prevBedH, prevSleepH, null, 0, table, prevHab);
        for (let i = 0; i < nMod; i++) modules[i]!.startDay(S[i]!, K[i]!, bus, hab, clock);
        for (let h = 0; h < 24; h++) {
          clock.hourOfDay = h;
          clock.hourIndex = clock.day * 24 + h;
          hour.day = clock.day;
          hour.hourIndex = clock.hourIndex;
          loadHour(table, h, hour);
          if (canonical) stepDefaultHour(S, K, bus, hour, hab, clock);
          else if (unrolled) stepHourAll(nMod, modules, S, K, bus, hour, hab, clock);
          else for (let i = 0; i < nMod; i++) modules[i]!.stepHour(S[i]!, K[i]!, bus, hour, hab, clock);
        }
        for (let i = 0; i < nMod; i++) modules[i]!.endOfDay(S[i]!, K[i]!, bus, hab, clock);
        prevBedH = hab.sleepBedH;
        prevSleepH = hab.sleepHours;
        prevHab = hab;
      }
      events.enabled = wasEnabled;
    }
    // end of burn-in (called also when burnIn = 0): NEAT0 calibration, FM/LT/SM reset, water re-anchoring (§3.4)
    clock.day = 0;
    clock.hourOfDay = 0;
    clock.hourIndex = 0;
    clock.weekday = profile.startWeekday;
    for (let i = 0; i < nMod; i++) {
      const m = modules[i]!;
      if (m.endBurnIn) m.endBurnIn(S[i]!, K[i]!, bus, ctx);
    }
    // t = 0 (midnight) scale minus the entered weight: the habitual overnight fall to the wake hour (morning anchor);
    // replaced by the O-5 value at day 0's wake hour in the main loop
    t0WeightErr = bus.scaleWeightKg - profile.weightKg;
    t0Scale = bus.scaleWeightKg;
  }
  clock.day = 0;
  clock.hourOfDay = 0;
  clock.hourIndex = 0;
  clock.weekday = profile.startWeekday;

  let snapshotOut: EngineSnapshot | undefined;
  if (options.captureSnapshot) {
    const busVals = new Float64Array(SIGNAL_DEFS.length);
    const b = bus as unknown as Record<string, number>;
    for (let j = 0; j < SIGNAL_DEFS.length; j++) busVals[j] = b[SIGNAL_DEFS[j]!.name]!;
    snapshotOut = {
      key,
      moduleIds: modules.map((m) => m.id),
      states: S.map((s) => structuredClone(s)),
      bus: busVals,
      prevBedH,
      prevSleepH,
      t0WeightErrKg: t0WeightErr,
      contracts: CONTRACT_FINGERPRINT,
    };
    if (stopAfterBurnIn) return snapshotOut;
  }
  // D8-06: day 0's morning follows the last OBSERVED sleep episode before the plan (it ended on day 0), not the burn-in's
  // habitual night. Applied after the post-burn-in capture so the snapshot stays schedule-independent; a day-stamped
  // continuation carries day k − 1's night in its snapshot instead.
  if (!dayStamped && compiled.initialSleep !== undefined) {
    const is = compiled.initialSleep;
    if (Number.isFinite(is.bedClockH) && Number.isFinite(is.sleepHours) && is.sleepHours > 0) {
      prevBedH = is.bedClockH;
      prevSleepH = is.sleepHours;
    }
  }

  // modules whose record hooks can write an enabled series (planner runs record a handful of series)
  const needH = recordersNeeded(modules, seriesEnabled, 'hourly');
  const needD = recordersNeeded(modules, seriesEnabled, 'daily');
  const mH: AnyEngineModule[] = [];
  const sH: object[] = [];
  const kH: object[] = [];
  for (let i = 0; i < nMod; i++) {
    if (!needH[i]) continue;
    mH.push(modules[i]!);
    sH.push(S[i]!);
    kH.push(K[i]!);
  }
  const nH = mH.length;
  const recUnrolled = nH <= MAX_UNROLLED;
  // detail series that mirror a bus signal (SIGNAL_MIRRORS): recorded by the core when requested
  const mirrorHIdx: number[] = [];
  const mirrorHSig: string[] = [];
  const mirrorDIdx: number[] = [];
  const mirrorDSig: string[] = [];
  for (const mr of SIGNAL_MIRRORS) {
    const i = SERIES_INDEX[mr.series];
    if (seriesEnabled[i] !== 1 || record === 'none') continue;
    if (seriesDef(mr.series).resolution === 'hourly') {
      mirrorHIdx.push(i);
      mirrorHSig.push(mr.signal);
    } else {
      mirrorDIdx.push(i);
      mirrorDSig.push(mr.signal);
    }
  }
  const nMirH = mirrorHIdx.length;
  const nMirD = mirrorDIdx.length;
  const busRec = bus as unknown as Record<string, number>;

  // ---- t = 0 values
  if (record !== 'none') {
    recorder.beginHour();
    for (let i = 0; i < nMod; i++) modules[i]!.recordHour(S[i]!, K[i]!, bus, recorder.hourFrame);
    for (let j = 0; j < nMirH; j++) recorder.hourFrame[mirrorHIdx[j]!] = busRec[mirrorHSig[j]!]!;
    recorder.beginDay();
    for (let i = 0; i < nMod; i++) modules[i]!.recordDay(S[i]!, K[i]!, bus, recorder.dayFrame);
    for (let j = 0; j < nMirD; j++) recorder.dayFrame[mirrorDIdx[j]!] = busRec[mirrorDSig[j]!]!;
    recorder.captureInitial();
  }
  // D7-02: accepted measured lab values are the exact t = 0 values (status on an out-of-domain projection); a day-stamped
  // continuation takes the anchors its snapshot carries (its first frame is day k, not t = 0)
  const observedAnchors = record === 'none' ? [] : applyObservedAnchors(profile, params, modules, recorder, seriesEnabled, dayStamped ? (snap.observedAnchors ?? []) : undefined);

  // global planned-fast mask (built once)
  const fastMask = new Uint8Array(nDays * 24);
  for (const sp of compiled.fastSpans) for (let h = sp.startHour; h < sp.endHour && h < nDays * 24; h++) fastMask[h] = 1;

  // ---- conservation checks (MODEL_SPEC §9.1 O-4/O-5), test mode only: identities between fluxes and STATES
  const checks = ctx.checks;
  const etaF = optParam(ctx, 'composition.etaF', 179);
  const etaL = optParam(ctx, 'composition.etaL', 229);
  const rhoF = optParam(ctx, 'composition.rhoF', RHO.fat);
  const rhoL = optParam(ctx, 'composition.rhoL', 1816);
  const effF = rhoF + etaF;
  const effL = rhoL + etaL;
  const rhoG = RHO.glycogenPerG;
  let storageMax = 0;
  let depMax = 0;
  let glyMax = 0;
  let energyDayMax = 0;
  let massMax = 0;
  let eiTot = 0;
  let teeTot = 0;
  let storedTot = 0;
  let pFm = bus.fatMassKg;
  let pLt = bus.leanTissueKg;
  let pG = bus.liverGlycogenG + bus.muscleGlycogenG;
  // D1-08: the tissue-ledger guard runs in every mode when every term of the identity has its writer in the run. An hour
  // whose committed tissue change does not close the identity (a numerical floor clipped a flux) ends the run before it is
  // recorded: later values are never forecasts, the validity says until which hour the ledger closed.
  const guardOn = ledgerGuardApplies(modules);
  let gFm = bus.fatMassKg;
  let gLt = bus.leanTissueKg;
  let limitHour = -1;
  let limitValidThrough = -1;
  let limitReason = 'tissueLedgerNotConserved';
  // D1-08: composition flags a tissue-floor hour itself (1 = solved as a conserved boundary: the hour is valid, the run
  // stops after it; ≥ 2 = not conservable: the run stops before it)
  const compLimit = compIdx0(modules, S);

  // runtime-reference latches for 'blockStart'
  let latchBlock = -2;
  let latchMaint = person.tdee0Kcal;
  let latchMass = profile.weightKg;
  let latchFfm = profile.ffm0Kg;
  const refs = { maintenanceKcal: 0, bodyMassKg: 0, ffmKg: 0 };
  let aborted: SimulationResult['meta']['aborted'];

  // ---- living plan hooks (CR-L1 restore/capture, CR-L2 anchors, CR-L3 intake offset); all no-ops unless requested
  if (dayStamped) {
    if (snap!.latch) {
      latchBlock = snap!.latch.block;
      latchMaint = snap!.latch.maintenanceKcal;
      latchMass = snap!.latch.bodyMassKg;
      latchFfm = snap!.latch.ffmKg;
    }
    restoreTracePrefix(safetyTrace, snap!);
  }
  const captureMask = captureDayMask(options.captureSnapshotAt, nDays);
  const snapshotsOut: Record<number, EngineSnapshot> = {};
  let anchorByDay: Map<number, AnchorSpec> | null = null;
  if (options.anchors && options.anchors.length > 0) {
    anchorByDay = new Map();
    for (const a of options.anchors) {
      if (anchorByDay.has(a.day)) throw new Error(`two anchors on day ${a.day}`);
      anchorByDay.set(a.day, a);
    }
  }
  const anchorsApplied: AnchorApplied[] = [];
  const compIdx = modules.findIndex((m) => m.id === 'composition');
  const anchorConsts = { rhoF, rhoL, smLossShare: optParam(ctx, 'composition.smLossShare', 0.5) };
  const offsets = intakeOffsetArray(options.intakeOffsetKcal, nDays);
  // D5-03: the correction each day actually received (kcal) and whether it was skipped (zero-energy day), filled in place
  const offApplied = offsets === null ? null : new Float64Array(nDays);
  const offSkipped = offsets === null ? null : new Uint8Array(nDays);
  let lastDay = restoreDay - 1;
  // two scratches, alternating by day: the previous day's offset copy stays valid for the after-midnight carry
  const offsetScratch = [newOffsetScratch(), newOffsetScratch()] as const;
  // review V1a-M2/L2 carry: the day before as simulated (its items after midnight land in today's hours). Day 0 starts
  // clean (the burn-in's last evening is not carried into the plan). A day-k resume rebuilds day k−1 from the compiled
  // day; for a runtime-resolved day that is its compile-time resolution (the carried part may differ slightly).
  let prevDayIn: DayInput | null = null;
  if (restoreDay > 0) {
    const pd = restoreDay - 1;
    const p = compiled.days[pd]!;
    prevDayIn = offsets === null || offsets[pd] === 0 ? p : offsetDayIntake(p, offsets[pd]!, offsetScratch[pd & 1]!);
  }

  // ---- main loop
  for (let d = restoreDay; d < nDays; d++) {
    const planned = compiled.days[d]!;
    clock.day = d;
    clock.weekday = planned.weekday;
    // CR-L2 anchor, then CR-L1 capture, both at the very start of the day
    const anchor = anchorByDay !== null ? anchorByDay.get(d) : undefined;
    if (anchor) {
      if (compIdx < 0) throw new Error('anchors need the composition module');
      anchorsApplied.push(applyTissueAnchor(S[compIdx], bus as unknown as AnchorBusView, anchor, anchorConsts));
      // the jump is exogenous (booked in meta.anchors), never an hourly flux of the conservation identities
      pFm = bus.fatMassKg;
      pLt = bus.leanTissueKg;
      gFm = pFm;
      gLt = pLt;
    }
    if (captureMask !== null && captureMask[d] === 1) {
      snapshotsOut[d] = {
        ...captureDaySnapshot({
          key: daySnapshotKey(profile, compiled.startDate, modules, params.values, ctx, d),
          day: d,
          modules,
          states: S,
          bus,
          prevBedH,
          prevSleepH,
          t0WeightErrKg: t0WeightErr,
          latch: { block: latchBlock, maintenanceKcal: latchMaint, bodyMassKg: latchMass, ffmKg: latchFfm },
          trace: safetyTrace,
        }),
        contracts: CONTRACT_FINGERPRINT,
        ...(observedAnchors.length > 0 ? { observedAnchors } : {}),
      } satisfies EngineSnapshot;
    }
    if (planned.runtime) {
      if (planned.energyReference === 'blockStart') {
        if (planned.blockIndex !== latchBlock || planned.blockStartDay === d) {
          latchBlock = planned.blockIndex;
          latchMaint = bus.maintenanceKcalD;
          latchMass = bus.tissueMassKg;
          latchFfm = bus.ffmActKg;
        }
        refs.maintenanceKcal = latchMaint + (planned.activityAdjKcal ?? 0);
        refs.bodyMassKg = latchMass;
        refs.ffmKg = latchFfm;
      } else {
        // R-MAINT: energy's instantaneous maintenance at habitual activity (current masses, AT and compensation states)
        // plus the day's planned-activity adjustment Δ/(1 − α0) (compileSchedule / core/activityReference.ts)
        refs.maintenanceKcal = bus.maintenanceKcalD + (planned.activityAdjKcal ?? 0);
        refs.bodyMassKg = bus.tissueMassKg;
        refs.ffmKg = bus.ffmActKg;
      }
      resolveDayInPlace(planned, refs, profile);
      // D4-01: the resolved exposure of a runtime day is final only now (refreshed in place, no allocation)
      if (planned.exposure !== undefined) writeDayExposure(planned);
    }
    // CR-L3: the modules see the day with the bias offset; the input echoes keep the planned/logged day
    const day = offsets === null || offsets[d] === 0 ? planned : offsetDayIntake(planned, offsets[d]!, offsetScratch[d & 1]!);
    if (offApplied !== null && offsets![d] !== 0) {
      // D5-03: actual applied correction (a zero-intake / no-meal day is left alone; the macro scaling may clip at 0)
      offApplied[d] = day === planned ? 0 : day.energyKcal - planned.energyKcal;
      offSkipped![d] = day === planned ? 1 : 0;
    }
    expandDayToHours(day, prevBedH, prevSleepH, fastMask, d * 24, table, prevDayIn);
    for (let i = 0; i < nMod; i++) modules[i]!.startDay(S[i]!, K[i]!, bus, day, clock);
    const dayFm0 = bus.fatMassKg;
    const dayLt0 = bus.leanTissueKg;
    const dayG0 = bus.liverGlycogenG + bus.muscleGlycogenG;
    let dayEi = 0;
    let dayTee = 0;
    let dayKet = 0;
    const wakeH = wakeRecordHour(day.sleepWakeH);
    for (let h = 0; h < 24; h++) {
      clock.hourOfDay = h;
      clock.hourIndex = d * 24 + h;
      hour.day = d;
      hour.hourIndex = clock.hourIndex;
      loadHour(table, h, hour);
      if (canonical) stepDefaultHour(S, K, bus, hour, day, clock);
      else if (unrolled) stepHourAll(nMod, modules, S, K, bus, hour, day, clock);
      else for (let i = 0; i < nMod; i++) modules[i]!.stepHour(S[i]!, K[i]!, bus, hour, day, clock);
      let boundaryHour = false;
      if (compLimit !== null && compLimit.limitThisHour !== 0) {
        if (compLimit.limitThisHour >= 2) {
          limitHour = clock.hourIndex;
          limitValidThrough = clock.hourIndex - 1;
          limitReason = 'tissueFloorModelLimit';
          break;
        }
        boundaryHour = true;
      }
      if (guardOn) {
        // D1-08: S_h = (ρF + ηF)·ΔFM + (ρL + ηL)·ΔLT must close for the committed hour (masses finite, FM ≥ 0, LT > 0)
        const fm = bus.fatMassKg;
        const lt = bus.leanTissueKg;
        const sh = bus.eAbsKcalH - bus.teePreKcalH - bus.dnlHeatKcalH - bus.ketoneLossKcalH - bus.glycogenChangeKcalH;
        const res = sh - (effF * (fm - gFm) + effL * (lt - gLt));
        if (!(Math.abs(res) <= LEDGER_LIMIT_TOL_KCAL) || !(fm >= 0) || !(lt > 0)) {
          limitHour = clock.hourIndex;
          limitValidThrough = clock.hourIndex - 1;
          limitReason = 'tissueLedgerNotConserved';
          break;
        }
        gFm = fm;
        gLt = lt;
      }
      if (record !== 'none') {
        recorder.beginHour();
        if (recUnrolled) recordHourAll(nH, mH, sH, kH, bus, recorder.hourFrame);
        else for (let i = 0; i < nH; i++) mH[i]!.recordHour(sH[i]!, kH[i]!, bus, recorder.hourFrame);
        for (let j = 0; j < nMirH; j++) recorder.hourFrame[mirrorHIdx[j]!] = busRec[mirrorHSig[j]!]!;
        recorder.commitHour(d, h, h === wakeH);
      }
      // O-5 with the morning anchor (MODEL_SPEC §3.4): the day-0 wake-hour scale weight equals the entered weight
      if (d === 0 && h === wakeH) t0WeightErr = bus.scaleWeightKg - profile.weightKg;
      if (checks) {
        const fm = bus.fatMassKg;
        const lt = bus.leanTissueKg;
        const g = bus.liverGlycogenG + bus.muscleGlycogenG;
        const dFm = fm - pFm;
        const dLt = lt - pLt;
        const sh = bus.eAbsKcalH - bus.teePreKcalH - bus.dnlHeatKcalH - bus.ketoneLossKcalH - bus.glycogenChangeKcalH;
        const r1 = Math.abs(sh - (effF * dFm + effL * dLt));
        const r2 = Math.abs(bus.depositionCostKcalH - (etaF * dFm + etaL * dLt));
        const r3 = Math.abs(bus.glycogenChangeKcalH - rhoG * (g - pG));
        if (r1 > storageMax || r1 !== r1) storageMax = r1 !== r1 ? Number.POSITIVE_INFINITY : r1;
        if (r2 > depMax || r2 !== r2) depMax = r2 !== r2 ? Number.POSITIVE_INFINITY : r2;
        if (r3 > glyMax || r3 !== r3) glyMax = r3 !== r3 ? Number.POSITIVE_INFINITY : r3;
        const m = Math.abs(bus.scaleWeightKg - (fm + bus.ffmActKg + bus.labileWaterKg));
        if (m > massMax || m !== m) massMax = m !== m ? Number.POSITIVE_INFINITY : m;
        dayEi += bus.eAbsKcalH;
        dayTee += bus.teePreKcalH + bus.dnlHeatKcalH + bus.depositionCostKcalH;
        dayKet += bus.ketoneLossKcalH;
        pFm = fm;
        pLt = lt;
        pG = g;
      }
      if (boundaryHour) {
        // conserved boundary: this hour closed the ledger and is recorded; later values would not be forecasts
        limitHour = clock.hourIndex;
        limitValidThrough = clock.hourIndex;
        limitReason = 'tissueFloorModelLimit';
        break;
      }
    }
    if (limitHour >= 0) break; // D1-08: day d is not committed (its daily values stay unrecorded)
    for (let i = 0; i < nMod; i++) modules[i]!.endOfDay(S[i]!, K[i]!, bus, day, clock);
    if (record !== 'none') {
      recorder.beginDay();
      for (let i = 0; i < nMod; i++) if (needD[i]) modules[i]!.recordDay(S[i]!, K[i]!, bus, recorder.dayFrame);
      for (let j = 0; j < nMirD; j++) recorder.dayFrame[mirrorDIdx[j]!] = busRec[mirrorDSig[j]!]!;
      recordInputs(planned, bus, recorder.dayFrame);
      recorder.commitDay(d);
    }
    if (checks) {
      // daily O-4 from states: EI − TEE − ρG·ΔG − ketone loss = ρF·ΔFM + ρL·ΔLT (TEE incl. the signed deposition cost)
      const fm = bus.fatMassKg;
      const lt = bus.leanTissueKg;
      const g = bus.liverGlycogenG + bus.muscleGlycogenG;
      const tissue = rhoF * (fm - dayFm0) + rhoL * (lt - dayLt0);
      const gly = rhoG * (g - dayG0);
      const r = Math.abs(dayEi - dayTee - gly - dayKet - tissue);
      if (r > energyDayMax || r !== r) energyDayMax = r !== r ? Number.POSITIVE_INFINITY : r;
      eiTot += dayEi;
      teeTot += dayTee;
      storedTot += tissue + gly;
      // endOfDay hooks may move masses (daily bookkeeping); the next hour compares against the published values
      pFm = fm;
      pLt = lt;
      pG = g;
    }
    // endOfDay hooks may move masses (daily bookkeeping); the guard compares the next hour against the published values
    gFm = bus.fatMassKg;
    gLt = bus.leanTissueKg;
    lastDay = d;
    prevBedH = day.sleepBedH;
    prevSleepH = day.sleepHours;
    prevDayIn = day;
    // early abort (planner): graded magnitude; series bounds on the recorded daily value, trace bounds on today's trace
    for (let b = 0; b < nAbort; b++) {
      const tr = abortTrace[b];
      const v = tr !== null ? tr![d]! : recorder.lastValue(abortSeries[b]!);
      const viol = abortLess[b] === 1 ? abortValue[b]! - v : v - abortValue[b]!;
      if (viol > 0) {
        aborted = { day: d, bound: abortOn[b]!.id, magnitude: viol };
        break;
      }
    }
    if (aborted || bus.safetyAbort === 1) {
      if (!aborted) aborted = { day: d, bound: 'safety', magnitude: 1 };
      break;
    }
  }

  // ---- finalize (allocation allowed)
  const warnings: SimulationResult['warnings'] = [];
  for (let i = 0; i < nMod; i++) modules[i]!.finalize(S[i]!, K[i]!, { warnings });
  const exp = recorder.export(seriesIds);
  const cPerson = {
    sex: profile.sex,
    ageYears: profile.ageYears,
    heightM: profile.heightM,
    waistCm: profile.body.circumferences.waistCm,
    whtr: profile.body.circumferences.waistCm / (100 * profile.heightM),
    weightKg: profile.weightKg,
  };
  const constraints = options.constraints ? computeConstraintMargins(safetyTrace, cPerson) : undefined;
  const warningMargins = options.constraints ? computeWarningMargins(safetyTrace, cPerson) : undefined;
  // A1-013/A1-022/A1-025/A1-031: the compiled inputs' own unknowns condition their dependent outputs (earliest first)
  const inputDetails = applyInputDependencyStatuses(compiled, modules, recorder);
  const intakeAssumptions = modules.some((m) => m.id === 'energy') ? applyEnergyIntakeAssumptions(compiled, recorder) : [];
  // D1-08: a model-limit termination; every series carries the status from the first unconserved day on
  let validity: DomainValidity | undefined;
  if (limitHour >= 0) {
    const limitDay = Math.floor(limitHour / 24);
    // composition's own record of the boundary, when it set one, says until which hour the ledger closed
    const lim = compLimit !== null && hasKeys(compLimit, ['modelLimitHour', 'modelLimitKind']) ? compositionModelLimit(compLimit as unknown as CompositionState) : null;
    const through = lim !== null && lim.hourIndex === limitHour ? lim.validThroughHour : limitValidThrough;
    validity = { status: 'modelLimit', validThroughHour: through, reasonCode: limitReason, version: VALIDITY_VERSION };
    if (record !== 'none') for (const id of seriesIds) recorder.setStatus(SERIES_INDEX[id], { status: 'modelLimit', reasonCode: limitReason, fromDay: limitDay });
  }
  if (record !== 'none') applyModuleStatuses(modules, S, K, recorder);
  const intakeAssumptionIds = modules.some((m) => m.id === 'intake') ? applyIntakeAssumptions(compiled, params, recorder, profile) : [];
  const outputStatus = recorder.exportStatus(seriesIds);
  // D5-03: requested vs actually applied correction for every simulated day with a non-zero request
  const offsetsApplied: OffsetApplied[] = [];
  if (offApplied !== null) {
    for (let d = restoreDay; d <= lastDay; d++) {
      const req = offsets![d]!;
      if (req === 0) continue;
      offsetsApplied.push({ day: d, requestedKcal: req, appliedKcal: offApplied[d]!, ...(offSkipped![d] === 1 ? { skippedReason: 'zeroEnergyDay' as const } : {}) });
    }
  }
  const resolution = runResolution(compiled);
  const assumptions: string[] = [];
  for (const m of modules) for (const a of MODULE_ASSUMPTIONS[m.id] ?? []) if (!assumptions.includes(a)) assumptions.push(a);
  for (const a of intakeAssumptions) if (!assumptions.includes(a)) assumptions.push(a);
  for (const a of intakeAssumptionIds) if (!assumptions.includes(a)) assumptions.push(a);
  // A1-013/A1-022/A1-025/A1-031 input dependencies and A1-040 step-overlap operands, with their structured detail
  const assumptionDetails = [...inputDetails, ...stepsOverlapDetails(compiled, profile, modules)];
  for (const a of assumptionDetails) if (!assumptions.includes(a.id)) assumptions.push(a.id);
  // D3-05: the muscle module's growth scenario for this profile (stable burn-in anchor, plateau reference or progress)
  const mi = modules.findIndex((m) => m.id === 'muscle');
  if (mi >= 0 && hasKeys(K[mi], ['scenario'])) {
    const g = growthScenarioFor(K[mi] as MuscleK, person).assumption;
    if (!assumptions.includes(g)) assumptions.push(g);
  }
  // C2/D2-01: replayed days read whole-day inputs at day start (energy/composition/water/muscle/fasting declarations)
  if ((resolution === 'daily' || resolution === 'scenario') && !assumptions.includes('dailyNativeModel')) assumptions.push('dailyNativeModel');
  const t1 = typeof performance !== 'undefined' ? performance.now() : 0;
  return {
    meta: {
      engineVersion: ENGINE_VERSION,
      registryHash: params.registryHash,
      nDays,
      startDate: compiled.startDate,
      startWeekday: compiled.startWeekday,
      record,
      series: seriesIds,
      runtimeMs: t1 - t0,
      ...(aborted ? { aborted } : {}),
      compileNotes: compiled.notes,
      ...(restoreDay > 0 ? { startDay: restoreDay } : {}),
      ...(anchorsApplied.length > 0 ? { anchors: anchorsApplied } : {}),
      contracts: CONTRACT_FINGERPRINT,
      ...(resolution !== undefined ? { resolution } : {}),
      ...(validity ? { validity } : {}),
      ...(offsetsApplied.length > 0 ? { offsetsApplied } : {}),
      ...(assumptions.length > 0 ? { assumptions } : {}),
      ...(assumptionDetails.length > 0 ? { assumptionDetails } : {}),
      ...(options.structuralModes && Object.keys(options.structuralModes).length > 0 ? { structuralModes: { ...options.structuralModes } } : {}),
      ...(observedAnchors.length > 0 ? { observedAnchors } : {}),
      ...(outputStatus ? { outputStatus } : {}),
      ...(checks
        ? {
            checks: {
              energyMaxAbsKcal: Math.max(storageMax, depMax, glyMax),
              energyDayMaxAbsKcal: energyDayMax,
              massMaxAbsKg: massMax,
              t0WeightErrKg: t0WeightErr,
              t0ScaleKg: t0Scale,
              storageMaxAbsKcal: storageMax,
              depositionMaxAbsKcal: depMax,
              glycogenMaxAbsKcal: glyMax,
              eiTotalKcal: eiTot,
              teeTotalKcal: teeTot,
              storedTotalKcal: storedTot,
            },
          }
        : {}),
    },
    initial: exp.initial,
    daily: exp.daily,
    hourly: exp.hourly,
    final: exp.final,
    safety: safetyTrace,
    events: events.toArray(),
    warnings,
    ...(constraints ? { constraints } : {}),
    ...(warningMargins ? { warningMargins } : {}),
    ...(snapshotOut ? { snapshot: snapshotOut } : {}),
    ...(captureMask !== null ? { snapshots: snapshotsOut } : {}),
  };
}

/** Public entry: accepts UI-level inputs, resolves and compiles them, then runs the engine. */
export function simulate(
  profile: PersonProfile | ResolvedProfile,
  schedule: Schedule | CompiledSchedule,
  options: RunOptions = {},
): SimulationResult {
  const rp = 'body' in profile && 'rmr0Kcal' in profile ? (profile as ResolvedProfile) : resolveProfile(profile as PersonProfile);
  const cs = 'fastSpans' in schedule ? (schedule as CompiledSchedule) : compileSchedule(schedule as Schedule, rp);
  return runEngine(rp, cs, options);
}

/**
 * Ensemble run (MODEL_SPEC §8, D8-02): nominal + `draws` Latin-hypercube parameter draws (common seed ⇒ common random
 * numbers across candidates). Percentiles per day for every recorded daily series come from the stochastic members only
 * (`core/bands.ts`, the same reducer as the Simulator's streaming bands); the nominal run is returned separately and never
 * mixed into the quantiles. Series presented as change from baseline use each member's change from its own t = 0 value,
 * re-based on the nominal t = 0 value. Zero draws (or no valid member value) export no band: `method: 'none'`, no
 * p10/p50/p90 arrays. `bandMeta` says what each band is: a parameter-sensitivity range, coverage unvalidated.
 *
 * A1-049: every member crosses the reducer as an envelope (`memberEnvelope`: daily values with its own output status,
 * validity and abort), so `bandDays` gives per series and day the attempted/valid/excluded counts, the exclusion reasons,
 * the members' conditional status and onset, and whether that day has a usable range (no valid member, or a model-limit/
 * domain exclusion ⇒ none). A1-065: the members keep the caller's fixed (structural) values and `structuralModes`.
 */
export function simulateEnsemble(
  profile: PersonProfile | ResolvedProfile,
  schedule: Schedule | CompiledSchedule,
  opts: { draws: number; seed: number } & RunOptions,
): BandedResult {
  const rp = 'body' in profile && 'rmr0Kcal' in profile ? (profile as ResolvedProfile) : resolveProfile(profile as PersonProfile);
  const cs = 'fastSpans' in schedule ? (schedule as CompiledSchedule) : compileSchedule(schedule as Schedule, rp);
  const nominal = runEngine(rp, cs, opts);
  const draws = Math.max(0, Math.floor(opts.draws));
  const defs = buildModelParams(MODULES).defs;
  const vectors = ensembleMemberVectors(defs, { count: draws, seed: opts.seed }, opts.paramOverrides);
  const members = vectors.map((v) => memberEnvelope(runEngine(rp, cs, { ...opts, record: 'daily', paramOverrides: v, collectEvents: false })));
  const b = ensembleBands(nominal.daily, nominal.initial, members);
  const modes = opts.structuralModes && Object.keys(opts.structuralModes).length > 0 ? { structuralModes: { ...opts.structuralModes } } : {};
  return { nominal, draws, p10: b.p10, p50: b.p50, p90: b.p90, method: b.method, bandMeta: b.bandMeta, bandDays: b.bandDays, ...modes };
}
