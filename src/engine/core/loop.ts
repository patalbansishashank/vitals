/**
 * The simulation loop (docs/MODEL_SPEC.md §3): init → burn-in → endBurnIn → for each day { resolve runtime inputs →
 * startDay → 24 × stepHour (+ recordHour) → endOfDay → recordDay → checks → abort test } → finalize.
 *
 * Hot-path rules: nothing inside the day/hour loops allocates. All buffers (hour table, frames, rings, event buffer)
 * are created before the loop. Determinism: no Math.random / Date inside the engine (timing uses performance.now()
 * only for `meta.runtimeMs`, which is not part of the physics).
 *
 * Performance notes (MODEL_SPEC §0.3, O-11): the hourly hooks go through the unrolled dispatch (`core/dispatch.ts`,
 * monomorphic call site per module index); `recordHour`/`recordDay` are called only for modules that own at least one
 * enabled series (planner runs record a handful of series); one hour table and one HourInput serve burn-in and run.
 */
import type { AnyEngineModule, EventSink, ModuleContext, StepClock } from '../types/module';
import type { PersonProfile, ResolvedProfile } from '../types/profile';
import type { CompiledSchedule, DayInput } from '../types/inputs';
import type { Schedule } from '../types/schedule';
import type { AnchorApplied, AnchorSpec, BandedResult, EngineSnapshot, RunOptions, SafetyTrace, SafetyTraceKey, SimulationResult } from '../types/result';
import { EVENT_TYPES, type SimEvent, type SimEventType, EVENT_CODE } from '../types/events';
import { createSignalBus, SIGNAL_DEFS, type SignalBus } from '../types/signals';
import { MI, N_SERIES, SERIES, SERIES_INDEX, SIGNAL_MIRRORS, seriesDef, type SeriesId } from '../types/metrics';
import { MODULES } from './moduleRegistry';
import { buildModelParams, param, sampleParams, withOverrides } from './paramsRegistry';
import { Recorder } from './recorder';
import { DayHourTable, compileSchedule, expandDayToHours, habitualWeek, loadHour, newHourInput, resolveDayInPlace } from './compileSchedule';
import { resolveProfile } from './resolveProfile';
import { DEFAULTS, ENGINE_VERSION, RHO } from './defaults';
import { fnv1a, wakeRecordHour } from './math';
import { MAX_UNROLLED, recordHourAll, stepHourAll } from './dispatch';
import { computeConstraintMargins, computeWarningMargins } from '../model/safety/constraints';
// living plan (CR-L1 day-stamped snapshots, CR-L2 anchors, CR-L3 intake offset; docs/LIVING_PLAN.md)
import { captureDayMask, captureDaySnapshot, daySnapshotKey, restoreTracePrefix } from './snapshot';
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

const SAFETY_TRACE_KEYS: readonly SafetyTraceKey[] = [
  'ei7', 'tdee7', 'deficitPct7', 'ea7', 'tissueMassKg', 'rate14KgPerWk', 'rate14PctPerWk', 'cumLossPct', 'bmi', 'bodyFatPct',
  'fastHMax', 'fastH7', 'proteinGPerKgRw', 'fatPctEnergy', 'hungerIdx', 'eee7', 'fastDay', 'ei28', 'fastH7Cap', 'deficitPct28',
];

function newSafetyTrace(nDays: number): SafetyTrace {
  const f = () => new Float32Array(nDays).fill(Number.NaN);
  return {
    ei7: f(), tdee7: f(), deficitPct7: f(), ea7: f(), tissueMassKg: f(), rate14KgPerWk: f(), rate14PctPerWk: f(),
    cumLossPct: f(), bmi: f(), bodyFatPct: f(), fastHMax: f(), fastH7: f(), proteinGPerKgRw: f(), fatPctEnergy: f(), hungerIdx: f(),
    eee7: f(), fastDay: f(), ei28: f(), fastH7Cap: f(), deficitPct28: f(),
  };
}

const RMR_DEV_ID = 'energy.rmrIndividualFrac';

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
  const base = buildModelParams(modules);
  const params = options.paramOverrides ? withOverrides(base, options.paramOverrides) : base;
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
  const unrolled = nMod <= MAX_UNROLLED;
  const hour = newHourInput();
  const table = new DayHourTable();
  const clock: StepClock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
  // review V1a-L9: usual bed time equal to wake time is no sleep data; the defaults apply (as in compileSchedule)
  const noUsualSleep = (((profile.habits.wakeTimeH - profile.habits.bedTimeH) % 24) + 24) % 24 === 0;
  let prevBedH = noUsualSleep ? DEFAULTS.bedTimeH : profile.habits.bedTimeH;
  let prevSleepH = noUsualSleep ? (DEFAULTS.wakeTimeH - DEFAULTS.bedTimeH + 24) % 24 : (profile.habits.wakeTimeH - profile.habits.bedTimeH + 24) % 24;
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
    const expected = dayStamped ? daySnapshotKey(profile, compiled.startDate, modules, params.values, ctx, restoreDay) : key;
    if (snap.key !== expected) throw new Error('initialSnapshot does not match this run (profile, parameters, modules, start date, horizon, mode, series or burn-in differ)');
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
          if (unrolled) stepHourAll(nMod, modules, S, K, bus, hour, hab, clock);
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
    };
    if (stopAfterBurnIn) return snapshotOut;
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
    }
    if (captureMask !== null && captureMask[d] === 1) {
      snapshotsOut[d] = captureDaySnapshot({
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
      });
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
    }
    // CR-L3: the modules see the day with the bias offset; the input echoes keep the planned/logged day
    const day = offsets === null || offsets[d] === 0 ? planned : offsetDayIntake(planned, offsets[d]!, offsetScratch[d & 1]!);
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
      if (unrolled) stepHourAll(nMod, modules, S, K, bus, hour, day, clock);
      else for (let i = 0; i < nMod; i++) modules[i]!.stepHour(S[i]!, K[i]!, bus, hour, day, clock);
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
    }
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
 * Ensemble run (MODEL_SPEC §8): nominal + `draws` Latin-hypercube parameter draws (common seed ⇒ common random
 * numbers across candidates). Percentiles are computed per day for every recorded daily series; series presented as
 * change from baseline use each member's change from its own t = 0 value, re-based on the nominal t = 0 value.
 */
export function simulateEnsemble(
  profile: PersonProfile | ResolvedProfile,
  schedule: Schedule | CompiledSchedule,
  opts: { draws: number; seed: number } & RunOptions,
): BandedResult {
  const rp = 'body' in profile && 'rmr0Kcal' in profile ? (profile as ResolvedProfile) : resolveProfile(profile as PersonProfile);
  const cs = 'fastSpans' in schedule ? (schedule as CompiledSchedule) : compileSchedule(schedule as Schedule, rp);
  const nominal = runEngine(rp, cs, opts);
  const defs = buildModelParams(MODULES).defs;
  const vectors = sampleParams(defs, { count: opts.draws, seed: opts.seed });
  const runs = vectors.map((v) => runEngine(rp, cs, { ...opts, record: 'daily', paramOverrides: v, collectEvents: false }));
  const p10: BandedResult['p10'] = {};
  const p50: BandedResult['p50'] = {};
  const p90: BandedResult['p90'] = {};
  const method: BandedResult['method'] = {};
  const q = (arr: number[], p: number): number => {
    const s = arr.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (s.length === 0) return Number.NaN;
    const idx = (s.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return (s[lo] as number) + ((s[hi] as number) - (s[lo] as number)) * (idx - lo);
  };
  for (const id of Object.keys(nominal.daily) as SeriesId[]) {
    const nd = nominal.daily[id]!;
    const delta = seriesDef(id).presentation === 'deltaFromBaseline';
    const base0 = delta ? (nominal.initial[id] ?? Number.NaN) : 0;
    const a10 = new Float32Array(nd.length);
    const a50 = new Float32Array(nd.length);
    const a90 = new Float32Array(nd.length);
    for (let d = 0; d < nd.length; d++) {
      const vals = delta
        ? [nd[d]! - base0, ...runs.map((r) => (r.daily[id]?.[d] ?? Number.NaN) - (r.initial[id] ?? Number.NaN))]
        : [nd[d]!, ...runs.map((r) => r.daily[id]?.[d] ?? Number.NaN)];
      a10[d] = base0 + q(vals, 0.1);
      a50[d] = base0 + q(vals, 0.5);
      a90[d] = base0 + q(vals, 0.9);
    }
    p10[id] = a10;
    p50[id] = a50;
    p90[id] = a90;
    method[id] = opts.draws > 0 ? 'draws' : 'none';
  }
  return { nominal, draws: opts.draws, p10, p50, p90, method };
}
