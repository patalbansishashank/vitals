/**
 * Test helpers shared by the moderators and activity unit tests (WP-M1). Not part of the engine: it only builds a
 * ModuleContext, per-day inputs and a minimal day/hour loop that mirrors `core/loop.ts` (init → [burn-in] → days) so
 * a module (or the pair moderators + activity) can be driven directly with hand-built bus and input values.
 */
import { buildModelParams, withOverrides } from '../../core/paramsRegistry';
import { DayHourTable, compileSchedule, expandDayToHours, habitualDay, habitualTemplate, loadHour, newHourInput } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { N_SERIES } from '../../types/metrics';
import { createSignalBus, type SignalBus } from '../../types/signals';
import type { AnyEngineModule, ModuleContext, StepClock } from '../../types/module';
import type { DayInput, HourInput, SessionResolved } from '../../types/inputs';
import type { BodyInputs } from '../../body/types';
import type { PersonProfile, ResolvedProfile } from '../../types/profile';
import type { SafetyTrace } from '../../types/result';

/** 35-y male, 82 kg, 178 cm (core fixtures MAN) with explicit habits; startDate a Monday. */
export const PERSON: PersonProfile = {
  schemaVersion: 1,
  body: { sex: 'male', ageYears: 35, heightCm: 178, weightKg: 82 },
  habits: { typicalSteps: 7000, sessionsPerWeek: 0 },
  startDate: '2026-10-05',
};

export function person(patch: Omit<Partial<PersonProfile>, 'body'> & { body?: Partial<BodyInputs> } = {}): PersonProfile {
  return { ...PERSON, ...patch, body: { ...PERSON.body, ...(patch.body ?? {}) } };
}

const nanArr = (): Float32Array => new Float32Array(1).fill(Number.NaN);
const safetyTrace = (): SafetyTrace => ({
  ei7: nanArr(), tdee7: nanArr(), deficitPct7: nanArr(), ea7: nanArr(), tissueMassKg: nanArr(), rate14KgPerWk: nanArr(), rate14PctPerWk: nanArr(),
  cumLossPct: nanArr(), bmi: nanArr(), bodyFatPct: nanArr(), fastHMax: nanArr(), fastH7: nanArr(), proteinGPerKgRw: nanArr(), fatPctEnergy: nanArr(), hungerIdx: nanArr(),
});

/** Build a ModuleContext for `modules` with optional parameter overrides (by id, e.g. `{ 'moderators.hRef': 7.5 }`). */
export function makeCtx(
  modules: readonly AnyEngineModule[],
  p: PersonProfile = PERSON,
  overrides: Record<string, number> = {},
): ModuleContext {
  const profile: ResolvedProfile = resolveProfile(p);
  const base = buildModelParams(modules);
  const v = Float64Array.from(base.values);
  for (const [id, val] of Object.entries(overrides)) {
    const i = base.index.get(id);
    if (i === undefined) throw new Error(`unknown parameter ${id}`);
    v[i] = val;
  }
  const params = withOverrides(base, v);
  const schedule = compileSchedule(
    { schemaVersion: 1, startDate: p.startDate ?? '2026-10-05', horizonDays: 1, programs: [habitualTemplate(profile)], days: [{ program: 0 }] },
    profile,
  );
  return {
    profile,
    params,
    schedule,
    nDays: 1,
    mode: 'simulate',
    seriesEnabled: new Uint8Array(N_SERIES).fill(1),
    events: { emit: () => {} },
    checks: true,
    safetyTrace: safetyTrace(),
  };
}

export const newClock = (day: number, hourOfDay = 0, weekday = 0): StepClock => ({ day, hourOfDay, hourIndex: day * 24 + hourOfDay, weekday });

/** A habitual DayInput with fields patched (sessions must be passed through `withSessions`). */
export function makeDay(profile: ResolvedProfile, patch: Partial<DayInput> = {}): DayInput {
  const d = habitualDay(profile);
  Object.assign(d, patch);
  return d;
}

/** Copy of `day` with the given sessions (resolved form) in its fixed-size session array. */
export function withSessions(day: DayInput, sessions: Partial<SessionResolved>[]): DayInput {
  const d: DayInput = { ...day, sessions: day.sessions.map((s) => ({ ...s, setsByRegion: new Float64Array(s.setsByRegion) })) };
  sessions.forEach((s, i) => {
    Object.assign(d.sessions[i]!, s);
    if (s.setsByRegion) d.sessions[i]!.setsByRegion = s.setsByRegion;
  });
  d.nSessions = sessions.length;
  return d;
}

/** A cardio session at clock hour `startH` for `durationMin` at fraction `x` of VO2max (modality code 3 = cycle). */
export const cardio = (startH: number, durationMin: number, x: number, modality = 3): Partial<SessionResolved> => ({
  kind: 'cardio', startH, durationMin, modality, intensityFrac: x, met: Number.NaN, speedKmh: Number.NaN, powerW: Number.NaN, rpe: Number.NaN,
});

/** A resistance session (style MET `met`, `sets` hard sets over all regions). */
export const resistance = (startH: number, durationMin: number, met = 3.5, sets = 18, toFailure = false): Partial<SessionResolved> => ({
  kind: 'resistance', startH, durationMin, modality: 0, intensityFrac: Number.NaN, met, speedKmh: Number.NaN, powerW: Number.NaN, rpe: Number.NaN,
  setsByRegion: new Float64Array(9).fill(sets / 9), toFailure,
});

export interface MiniRun {
  bus: SignalBus;
  K: object[];
  S: object[];
  hour: HourInput;
}

/**
 * Minimal day/hour loop mirroring core/loop.ts for the given modules (in order): init, then `days` (day index = clock.day,
 * may start negative for a burn-in stretch). `beforeDay` may tweak the bus (e.g. energyBalanceFrac) before startDay.
 */
export function miniRun(
  modules: readonly AnyEngineModule[],
  ctx: ModuleContext,
  days: { clockDay: number; day: DayInput }[],
  hooks: {
    /** Called after every module's init (before any day), e.g. to pre-fill a module's rings. */
    afterInit?: (S: object[], K: object[], bus: SignalBus) => void;
    beforeDay?: (clockDay: number, bus: SignalBus) => void;
    beforeHour?: (clockDay: number, hourOfDay: number, bus: SignalBus) => void;
    afterHour?: (clockDay: number, hourOfDay: number, bus: SignalBus) => void;
    afterDay?: (clockDay: number, bus: SignalBus) => void;
    bus?: SignalBus;
  } = {},
): MiniRun {
  const bus = hooks.bus ?? createSignalBus();
  const K = modules.map((m) => m.prepare(ctx));
  const S = modules.map((m, i) => m.init(K[i]!, ctx, bus));
  hooks.afterInit?.(S, K, bus);
  const table = new DayHourTable();
  const hour = newHourInput();
  const clock = newClock(0);
  let prevBed = ctx.profile.habits.bedTimeH;
  let prevSleep = (((ctx.profile.habits.wakeTimeH - ctx.profile.habits.bedTimeH) % 24) + 24) % 24 || 24;
  for (const { clockDay, day } of days) {
    clock.day = clockDay;
    clock.weekday = (((ctx.profile.startWeekday + clockDay) % 7) + 7) % 7;
    expandDayToHours(day, prevBed, prevSleep, null, 0, table);
    hooks.beforeDay?.(clockDay, bus);
    for (let i = 0; i < modules.length; i++) modules[i]!.startDay(S[i]!, K[i]!, bus, day, clock);
    for (let h = 0; h < 24; h++) {
      clock.hourOfDay = h;
      clock.hourIndex = clockDay * 24 + h;
      hour.day = clockDay;
      hour.hourIndex = clock.hourIndex;
      loadHour(table, h, hour);
      hooks.beforeHour?.(clockDay, h, bus);
      for (let i = 0; i < modules.length; i++) modules[i]!.stepHour(S[i]!, K[i]!, bus, hour, day, clock);
      hooks.afterHour?.(clockDay, h, bus);
    }
    for (let i = 0; i < modules.length; i++) modules[i]!.endOfDay(S[i]!, K[i]!, bus, day, clock);
    hooks.afterDay?.(clockDay, bus);
    prevBed = day.sleepBedH;
    prevSleep = day.sleepHours;
  }
  return { bus, K, S, hour };
}
