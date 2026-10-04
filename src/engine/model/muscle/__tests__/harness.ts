/**
 * Test harness for the muscle module: drives `muscleModule` directly with hand-built bus values and compiled day inputs
 * (WP_BRIEF: never through the full loop — the other modules are stubs or in progress).
 *
 * Composition is emulated only where a validation target needs lean-tissue bookkeeping in a deficit:
 *  - `CompositionProxy` (default for 09 §7 #4-#8, review M13): MODEL_SPEC §1.8 deficit regime with composition's own
 *    pure partition functions (`pCatDeficit` = 03 leanFractionOfLoss RT-stripped, `deficitEnergyShare` with R_RT), the
 *    muscle module's rtAccretionKgD booked first at ρL + ηL. Daily resolution (one step per day).
 *  - `LeanProxy`: the protein-free Forbes baseline p0 = 10.4/(10.4 + FM) on which 09 §4.8 fitted d0/ρ_max.
 * Both are test devices, not implementations of composition.
 */
import { muscleModule, type MuscleK, type MuscleState } from '../index';
import { buildModelParams, withOverrides } from '../../../core/paramsRegistry';
import { resolveProfile } from '../../../core/resolveProfile';
import { DayHourTable, compileSchedule, expandDayToHours, loadHour, newHourInput } from '../../../core/compileSchedule';
import { RHO } from '../../../core/defaults';
import { createSignalBus, type SignalBus } from '../../../types/signals';
import { N_SERIES, MI } from '../../../types/metrics';
import type { DayInput, HourInput } from '../../../types/inputs';
import type { AnyEngineModule, EventSink, ModuleContext, StepClock } from '../../../types/module';
import type { PersonProfile, ResolvedProfile, TrainingHistory } from '../../../types/profile';
import type { DayTemplate, ExerciseSession, Schedule, TrainingRegion } from '../../../types/schedule';
import type { SafetyTrace } from '../../../types/result';
import type { SimEventType } from '../../../types/events';
import { compositionModule } from '../../composition/index';
import { deficitEnergyShare, pCatDeficit, readConstants, type CompositionConstants } from '../../composition/partition';

export const REGIONS: readonly TrainingRegion[] = [
  'chest', 'upperBack', 'shoulders', 'arms', 'core', 'glutes', 'quads', 'hamstrings', 'calves',
];

const MODS = [muscleModule] as unknown as readonly AnyEngineModule[];

export interface PersonOpts {
  sex?: 'male' | 'female';
  age?: number;
  heightCm?: number;
  weightKg?: number;
  bodyFatPct?: number;
  trainingYears?: number;
  trainingHistory?: TrainingHistory;
  sessionsPerWeek?: number;
  sexUnspecified?: boolean;
}

export function person(o: PersonOpts = {}): PersonProfile {
  return {
    schemaVersion: 1,
    body: {
      sex: o.sex ?? 'male',
      ageYears: o.age ?? 25,
      heightCm: o.heightCm ?? 178,
      weightKg: o.weightKg ?? 75,
      ...(o.bodyFatPct !== undefined ? { knownBodyFatPct: o.bodyFatPct, knownBodyFatSource: 'dxa' as const } : {}),
      ...(o.trainingYears !== undefined ? { trainingYears: o.trainingYears, trainingQuality: 'regular' as const } : {}),
    },
    ...(o.sexUnspecified ? { sexUnspecified: true } : {}),
    habits: {
      trainingHistory: o.trainingHistory ?? 'none',
      // a stated training history means a current RT habit (3 sessions/wk) unless sessions are given
      sessionsPerWeek: o.sessionsPerWeek ?? (o.trainingHistory !== undefined && o.trainingHistory !== 'none' ? 3 : 0),
      lifingCardioMix: 0,
    },
    startDate: '2026-10-05',
  };
}

function emptyTrace(): SafetyTrace {
  const f = () => new Float32Array(1);
  return {
    ei7: f(), tdee7: f(), deficitPct7: f(), ea7: f(), tissueMassKg: f(), rate14KgPerWk: f(), rate14PctPerWk: f(),
    cumLossPct: f(), bmi: f(), bodyFatPct: f(), fastHMax: f(), fastH7: f(), proteinGPerKgRw: f(), fatPctEnergy: f(), hungerIdx: f(),
  } as unknown as SafetyTrace;
}

export interface EmittedEvent {
  type: SimEventType;
  hour: number;
  value: number;
}

export function makeCtx(profile: ResolvedProfile, overrides?: Record<string, number>, mpsEnabled = true): { ctx: ModuleContext; events: EmittedEvent[] } {
  const base = buildModelParams(MODS);
  let params = base;
  if (overrides) {
    const v = new Float64Array(base.values);
    for (const [id, val] of Object.entries(overrides)) {
      const i = base.index.get(id);
      if (i === undefined) throw new Error(`unknown parameter ${id}`);
      v[i] = val;
    }
    params = withOverrides(base, v);
  }
  const events: EmittedEvent[] = [];
  const sink: EventSink = { emit: (type, hour, value) => void events.push({ type, hour, value }) };
  const seriesEnabled = new Uint8Array(N_SERIES).fill(1);
  if (!mpsEnabled) seriesEnabled[MI.mps] = 0;
  const sched: Schedule = {
    schemaVersion: 1,
    startDate: '2026-10-05',
    horizonDays: 1,
    programs: [{ id: 'x', label: 'x', energy: { kind: 'pctMaintenance', pct: 100 }, macros: { protein: { unit: 'g', value: 100 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } } } as DayTemplate],
    days: [{ program: 0 }],
  };
  const ctx: ModuleContext = {
    profile,
    params,
    schedule: compileSchedule(sched, profile),
    nDays: 1,
    mode: 'simulate',
    seriesEnabled,
    events: sink,
    checks: true,
    safetyTrace: emptyTrace(),
  };
  return { ctx, events };
}

// ------------------------------------------------------------------ day programs

export interface ProgramOpts {
  /** Protein, g per kg entered body weight per day. */
  proteinGkg?: number;
  /** Resistance sessions of this day: effective sets per region (number = all 9 regions). */
  sessions?: { startH: number; sets: number | Partial<Record<TrainingRegion, number>>; rir?: number; loadPct1RM?: number; restSec?: number; toFailure?: boolean; coldWaterImmersion?: boolean }[];
  meals?: number;
  windowStartH?: number;
  windowLengthH?: number;
  steps?: number;
  energyPct?: number;
  alcohol?: { clockH: number; drinks: number }[];
}

export function program(id: string, o: ProgramOpts = {}): DayTemplate {
  const exercise: ExerciseSession[] = (o.sessions ?? []).map((se) => {
    const setsByRegion: Partial<Record<TrainingRegion, number>> = {};
    for (const r of REGIONS) {
      const v = typeof se.sets === 'number' ? se.sets : (se.sets[r] ?? 0);
      if (v > 0) setsByRegion[r] = v;
    }
    return {
      kind: 'resistance',
      startH: se.startH,
      setsByRegion,
      rir: se.rir ?? 0,
      loadPct1RM: se.loadPct1RM ?? 75,
      restSec: se.restSec ?? 120,
      toFailure: se.toFailure ?? false,
      ...(se.coldWaterImmersion ? { coldWaterImmersion: true } : {}),
    };
  });
  return {
    id,
    label: id,
    energy: { kind: 'pctMaintenance', pct: o.energyPct ?? 100 },
    macros: { protein: { unit: 'gPerKgBw', value: o.proteinGkg ?? 1.4 }, carbs: { unit: 'pctEnergy', value: 45 }, fat: { unit: 'remainder' } },
    meals: { count: o.meals ?? 3, window: { startH: o.windowStartH ?? 8, lengthH: o.windowLengthH ?? 12 } },
    exercise,
    steps: o.steps ?? 7000,
    ...(o.alcohol ? { substances: { alcohol: o.alcohol } } : {}),
  } as DayTemplate;
}

/** Compile a repeating week (pattern of program indices, length 7) once; days are reused modulo 7. */
export function compileWeek(profile: ResolvedProfile, programs: DayTemplate[], pattern: number[]): DayInput[] {
  const sched: Schedule = {
    schemaVersion: 1,
    startDate: '2026-10-05',
    horizonDays: pattern.length,
    programs,
    days: pattern.map((p) => ({ program: p })),
  };
  return compileSchedule(sched, profile).days;
}

// ------------------------------------------------------------------ simulator

export interface SimOpts {
  overrides?: Record<string, number>;
  mpsEnabled?: boolean;
  /** Simulated burn-in days on the first day of the pattern with no sets (clock.day < 0). */
  burnIn?: number;
}

export class MuscleSim {
  readonly profile: ResolvedProfile;
  readonly k: MuscleK;
  readonly s: MuscleState;
  readonly bus: SignalBus;
  readonly hour: HourInput = newHourInput();
  readonly clock: StepClock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
  readonly events: EmittedEvent[];
  readonly out = new Float64Array(N_SERIES);
  private readonly table = new DayHourTable();
  day = 0;
  /** Hourly mps index of the last simulated day. */
  readonly mpsHours = new Float64Array(24);
  readonly stimHours = new Float64Array(24);

  constructor(input: PersonProfile, opts: SimOpts = {}) {
    this.profile = resolveProfile(input);
    const { ctx, events } = makeCtx(this.profile, opts.overrides, opts.mpsEnabled ?? true);
    this.events = events;
    this.bus = createSignalBus();
    // neutral bus values of what muscle reads (as composition/intake/moderators would write them)
    this.bus.ageYears = this.profile.ageYears;
    this.bus.ffmActKg = this.profile.ffm0Kg;
    this.bus.tissueMassKg = this.profile.ffm0Kg + this.profile.fm0Kg;
    this.bus.skeletalMuscleKg = this.profile.body.skeletalMuscleKg;
    this.bus.energyBalanceFrac = 0;
    this.bus.mpsSleepMult = 1;
    this.bus.strengthEaMult = 1;
    this.bus.creatineSatFrac = 0;
    this.bus.muscleGlycogenRel = 1;
    this.k = muscleModule.prepare(ctx);
    this.s = muscleModule.init(this.k, ctx, this.bus);
  }

  /** Run one day. `hourHook` may set bus/hour fields before each stepHour (e.g. raAaQGH). */
  runDay(d: DayInput, hourHook?: (h: number, hour: HourInput, bus: SignalBus) => void, burnIn = false): void {
    const m = muscleModule;
    this.clock.day = burnIn ? -1 : this.day;
    expandDayToHours(d, 23, 8, null, 0, this.table);
    m.startDay(this.s, this.k, this.bus, d, this.clock);
    for (let h = 0; h < 24; h++) {
      this.clock.hourOfDay = h;
      this.clock.hourIndex = this.clock.day * 24 + h;
      this.hour.day = this.clock.day;
      this.hour.hourIndex = this.clock.hourIndex;
      loadHour(this.table, h, this.hour);
      if (hourHook) hourHook(h, this.hour, this.bus);
      m.stepHour(this.s, this.k, this.bus, this.hour, d, this.clock);
      m.recordHour(this.s, this.k, this.bus, this.out);
      this.mpsHours[h] = this.out[MI.mps]!;
      this.stimHours[h] = this.bus.mpsStimWb;
    }
    m.endOfDay(this.s, this.k, this.bus, d, this.clock);
    m.recordDay(this.s, this.k, this.bus, this.out);
    if (!burnIn) this.day++;
  }

  /**
   * Burn-in as the core loop runs it (MODEL_SPEC §3.4): `days` days of the weekly pattern with clock.day < 0 (the pattern
   * day for each burn-in day is its weekday, day −1 = the pattern's last day), then `endBurnIn`.
   */
  burnIn(days: number, week: DayInput[]): void {
    for (let b = 0; b < days; b++) {
      const wd = (((b - days) % 7) + 7) % 7;
      this.runDay(week[wd % week.length]!, undefined, true);
    }
    muscleModule.endBurnIn!(this.s, this.k, this.bus, { burnInDays: days } as unknown as ModuleContext);
    muscleModule.recordDay(this.s, this.k, this.bus, this.out);
  }

  /** Run `n` days of a weekly pattern; `dayHook` runs before each day (set energyBalanceFrac etc.). */
  run(n: number, week: DayInput[], dayHook?: (d: number, bus: SignalBus) => void, afterDay?: (d: number) => void): void {
    for (let i = 0; i < n; i++) {
      if (dayHook) dayHook(this.day, this.bus);
      this.runDay(week[this.day % week.length]!);
      if (afterDay) afterDay(this.day - 1);
    }
  }

  /** Σ M_acc − Σ M_acc(0), kg (the `rtMuscleGain` metric). */
  gain(): number {
    let m = 0;
    for (let r = 0; r < 9; r++) m += this.s.mAcc[r]!;
    return m - this.s.mAcc0Sum;
  }

  strength(): number {
    return this.out[MI.strength]!;
  }
}

// ------------------------------------------------------------------ composition proxy for the deficit targets

/**
 * Minimal lean/fat bookkeeping following MODEL_SPEC §1.8 (deficit regime) with 03's Forbes baseline p0 only:
 * pCat = p0·(1 − R_RT), p_E = pCat(ρL + ηL)/[pCat(ρL + ηL) + (1 − pCat)(ρF + ηF)], explicit lean = rtAccretionKgD
 * (yesterday's) booked first at (ρL + ηL) or ρL, the remaining daily energy S′ split by p_E.
 */
export class LeanProxy {
  fm: number;
  lean = 0;
  fat = 0;
  constructor(fm0: number) {
    this.fm = fm0;
  }
  /** Advance one day with energy balance `ebKcal` (kcal/d, negative = deficit) and the muscle signals of yesterday. */
  step(ebKcal: number, rtAccretionKgD: number, rtRetentionFrac: number): void {
    const rhoL = 1816;
    const etaL = 229;
    const rhoF = RHO.fat;
    const etaF = 179;
    const x = rtAccretionKgD;
    const cost = x >= 0 ? (rhoL + etaL) * x : rhoL * x;
    const sp = ebKcal - cost;
    this.lean += x;
    if (sp < 0) {
      const p0 = 10.4 / (10.4 + this.fm);
      const pCat = p0 * (1 - rtRetentionFrac);
      const pE = (pCat * (rhoL + etaL)) / (pCat * (rhoL + etaL) + (1 - pCat) * (rhoF + etaF));
      this.lean += (pE * sp) / rhoL;
      const dF = ((1 - pE) * sp) / rhoF;
      this.fat += dF;
      this.fm += dF;
    } else {
      const dF = sp / (rhoF + etaF);
      this.fat += dF;
      this.fm += dF;
    }
  }
}

let compK: CompositionConstants | null = null;
function compositionConstants(): CompositionConstants {
  if (!compK) compK = readConstants(buildModelParams([compositionModule] as unknown as readonly AnyEngineModule[]));
  return compK;
}

/**
 * Daily lean/fat bookkeeping with composition's real deficit partition (MODEL_SPEC §1.8 steps 2c and 4):
 * pCat = pCatDeficit(q, d, bf, FM, sex, age, aerobicIdx), p_E = deficitEnergyShare(pCat, R_RT, 0); explicit lean
 * (yesterday's rtAccretionKgD) is booked first at effL, the remaining energy S′ is split by p_E. Energy balance ≥ 0
 * days put the residual into fat (the surplus regime is not needed by these targets).
 */
export class CompositionProxy {
  readonly kc = compositionConstants();
  fm: number;
  readonly ffm0: number;
  lean = 0;
  fat = 0;
  constructor(fm0: number, ffm0: number, readonly female: boolean, readonly age: number, readonly aerobicIdx = 0) {
    this.fm = fm0;
    this.ffm0 = ffm0;
  }
  step(ebKcal: number, teeKcal: number, proteinEffG: number, rtAccretionKgD: number, rtRetentionFrac: number): void {
    const k = this.kc;
    const ffm = this.ffm0 + this.lean;
    const bw = this.fm + ffm;
    const x = rtAccretionKgD;
    const sp = ebKcal - k.effL * x;
    let pE = 0;
    if (ebKcal < 0) {
      const d = Math.min(1, Math.max(0, -ebKcal / teeKcal));
      const pCat = pCatDeficit(k, proteinEffG / ffm, d, this.fm / bw, this.fm, this.female, this.age, this.aerobicIdx);
      pE = deficitEnergyShare(k, pCat, rtRetentionFrac, 0);
    }
    this.lean += x + (pE * sp) / k.effL;
    const dF = ((1 - pE) * sp) / k.effF;
    this.fat += dF;
    this.fm += dF;
  }
}

// ------------------------------------------------------------------ scenario helpers

/** Weekly pattern for n RT sessions per week (Mon/Wed/Fri style spacing). */
export function weekPattern(sessions: number): number[] {
  switch (sessions) {
    case 0: return [1, 1, 1, 1, 1, 1, 1];
    case 1: return [0, 1, 1, 1, 1, 1, 1];
    case 2: return [0, 1, 1, 0, 1, 1, 1];
    case 3: return [0, 1, 0, 1, 0, 1, 1];
    case 4: return [0, 1, 0, 1, 0, 0, 1];
    case 5: return [0, 0, 1, 0, 0, 0, 1];
    default: return [0, 0, 0, 0, 0, 0, 1];
  }
}

/** Compiled week with `sessions` RT days of `perSession` effective sets in every region (RIR 0, load `load` %1RM). */
export function rtWeek(sim: MuscleSim, perSession: number, sessions: number, proteinGkg: number, load = 75, extra: ProgramOpts = {}): DayInput[] {
  const A = program('A', { ...extra, proteinGkg, sessions: [{ startH: 17, sets: perSession, loadPct1RM: load }] });
  const B = program('B', { ...extra, proteinGkg });
  return compileWeek(sim.profile, [A, B], weekPattern(sessions));
}

/** RT at a fixed energy balance fraction e (energyBalanceFrac, as composition writes it; e = 0 per review m21). */
export function runRt(p: PersonOpts, days: number, perSession: number, sessions: number, proteinGkg: number, e = 0, load = 75): MuscleSim {
  const sim = new MuscleSim(person(p));
  const week = rtWeek(sim, perSession, sessions, proteinGkg, load);
  sim.run(days, week, (_d, bus) => void (bus.energyBalanceFrac = e));
  return sim;
}

export interface DeficitRun {
  sim: MuscleSim;
  /** Composition's real deficit partition (default). */
  comp: CompositionProxy;
  /** 09's calibration basis: protein-free Forbes partition. */
  forbes: LeanProxy;
  tdee: number;
}

/**
 * Constant deficit `deficitKcal` (kcal/d below the baseline TDEE) for `days`, with or without RT; the lean proxies see
 * yesterday's rtAccretionKgD / rtRetentionFrac (composition reads them d−1).
 */
export function runDeficit(p: PersonOpts, days: number, perSession: number, sessions: number, proteinGkg: number, deficitKcal: number, aerobicIdx = 0): DeficitRun {
  const sim = new MuscleSim(person(p));
  const tdee = sim.profile.tdee0Kcal;
  const week = sessions > 0 ? rtWeek(sim, perSession, sessions, proteinGkg) : compileWeek(sim.profile, [program('B', { proteinGkg })], [0]);
  const forbes = new LeanProxy(sim.profile.fm0Kg);
  const comp = new CompositionProxy(sim.profile.fm0Kg, sim.profile.ffm0Kg, sim.profile.sex === 'female', sim.profile.ageYears, aerobicIdx);
  const protG = proteinGkg * sim.profile.weightKg;
  let acc = 0;
  let ret = 0;
  sim.run(days, week, (_d, bus) => void (bus.energyBalanceFrac = -deficitKcal / tdee), () => {
    forbes.step(-deficitKcal, acc, ret);
    comp.step(-deficitKcal, tdee, protG, acc, ret);
    acc = sim.bus.rtAccretionKgD;
    ret = sim.bus.rtRetentionFrac;
  });
  return { sim, comp, forbes, tdee };
}

/** Deficit (kcal/d) where net lean change crosses zero, by linear interpolation over a sorted grid. */
export function zeroCrossing(grid: number[], net: number[]): number {
  for (let i = 1; i < grid.length; i++) {
    if (net[i - 1]! > 0 && net[i]! <= 0) return grid[i - 1]! + ((grid[i]! - grid[i - 1]!) * net[i - 1]!) / (net[i - 1]! - net[i]!);
  }
  return Number.NaN;
}
