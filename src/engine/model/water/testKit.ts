/**
 * Test harness for the water module (unit tests drive the module directly with hand-built bus/input values, WP_BRIEF).
 * Not part of the engine: only imported by `*.test.ts` in this folder.
 */
import { buildModelParams, withOverrides } from '../../core/paramsRegistry';
import { resolveProfile } from '../../core/resolveProfile';
import { habitualDay, newHourInput } from '../../core/compileSchedule';
import { defineModule } from '../../core/moduleKit';
import { MAN, WOMAN } from '../../core/__tests__/fixtures';
import { N_SERIES } from '../../types/metrics';
import { createSignalBus, type SignalBus } from '../../types/signals';
import type { DayInput, HourInput } from '../../types/inputs';
import type { AnyEngineModule, ModuleContext, StepClock } from '../../types/module';
import type { ParamDef } from '../../types/params';
import type { PersonProfile, ResolvedProfile } from '../../types/profile';
import type { SafetyTrace } from '../../types/result';
import type { SimEventType } from '../../types/events';
import { waterModule, type WaterConstants, type WaterState } from './index';

export { MAN, WOMAN };

export interface EmittedEvent {
  type: SimEventType;
  hourIndex: number;
  value: number;
}

export interface RigOptions {
  profile?: PersonProfile;
  /** Parameter overrides by id (nominal values otherwise). */
  overrides?: Record<string, number>;
  /** Extra registry entries (e.g. a fake `fuel.hWater`). */
  extraParams?: readonly ParamDef[];
  /** Days of burn-in the rig will run at the start (clock.day < 0), default 0. */
  burnInDays?: number;
  checks?: boolean;
  /** Habitual fibre exposure written to the bus before init, g/d (default: the profile's habitual fibre). */
  fibreG?: number;
}

export interface Rig {
  k: WaterConstants;
  s: WaterState;
  bus: SignalBus;
  day: DayInput;
  hour: HourInput;
  clock: StepClock;
  profile: ResolvedProfile;
  events: EmittedEvent[];
  /** Day index of the next hour to run (negative during burn-in). */
  dayIdx: number;
  hourOfDay: number;
  /** Advance `n` hours; `drive(hourIndex, rig)` runs before each step (edit bus/day/hour there). */
  step(n: number, drive?: (hourIndex: number, rig: Rig) => void): void;
  /** Days-worth of hours. */
  days(n: number, drive?: (hourIndex: number, rig: Rig) => void): void;
}

const emptyTrace = {} as SafetyTrace;

export function makeParams(overrides: Record<string, number> = {}, extra: readonly ParamDef[] = []) {
  const mods: AnyEngineModule[] = [waterModule as unknown as AnyEngineModule];
  if (extra.length > 0) {
    mods.push(
      defineModule<object>({ id: 'fuel', specSection: 't', dossiers: 't', params: extra, reads: [], writes: [], records: [], init: () => ({}) }) as unknown as AnyEngineModule,
    );
  }
  const base = buildModelParams(mods);
  if (Object.keys(overrides).length === 0) return base;
  const v = Float64Array.from(base.values);
  for (const [id, val] of Object.entries(overrides)) {
    const i = base.index.get(id);
    if (i === undefined) throw new Error(`unknown parameter ${id}`);
    v[i] = val;
  }
  return withOverrides(base, v);
}

export function makeRig(opts: RigOptions = {}): Rig {
  const profile = resolveProfile(opts.profile ?? MAN);
  const events: EmittedEvent[] = [];
  const ctx: ModuleContext = {
    profile,
    params: makeParams(opts.overrides, opts.extraParams),
    schedule: { nDays: 1, startDate: '2026-01-05', startWeekday: 0, days: [], fastSpans: [], notes: [] },
    nDays: 1,
    mode: 'simulate',
    seriesEnabled: new Uint8Array(N_SERIES).fill(1),
    events: { emit: (type, hourIndex, value) => void events.push({ type, hourIndex, value }) },
    checks: opts.checks ?? true,
    safetyTrace: emptyTrace,
  };
  const bus = createSignalBus();
  bus.tissueMassKg = profile.weightKg;
  bus.fatMassKg = profile.fm0Kg;
  bus.ffmActKg = profile.ffm0Kg;
  bus.leanTissueKg = profile.ffm0Kg;
  bus.liverGlycogenG = profile.body.glycogen.liverG;
  bus.muscleGlycogenG = profile.body.glycogen.muscleG;
  bus.carbAbs24G = profile.habitualCarbG;
  bus.fibreEffG = opts.fibreG ?? profile.habitualFibreG;
  const k = waterModule.prepare(ctx) as WaterConstants;
  const s = waterModule.init(k, ctx, bus) as WaterState;
  const day = habitualDay(profile);
  const hour = newHourInput();
  const clock: StepClock = { day: 0, hourOfDay: 0, hourIndex: 0, weekday: 0 };
  const rig: Rig = {
    k,
    s,
    bus,
    day,
    hour,
    clock,
    profile,
    events,
    dayIdx: -Math.max(0, Math.floor(opts.burnInDays ?? 0)),
    hourOfDay: 0,
    step(n, drive) {
      for (let i = 0; i < n; i++) {
        const h = this.hourOfDay;
        clock.day = this.dayIdx;
        clock.weekday = (((this.dayIdx % 7) + 7) % 7);
        if (h === 0) waterModule.startDay(s, k, bus, day, clock);
        clock.hourOfDay = h;
        clock.hourIndex = this.dayIdx * 24 + h;
        hour.day = this.dayIdx;
        hour.hourOfDay = h;
        hour.hourIndex = clock.hourIndex;
        hour.asleep = h >= 23 || h < 7 ? 1 : 0;
        if (drive) drive(clock.hourIndex, this);
        waterModule.stepHour(s, k, bus, hour, day, clock);
        if (h === 23) {
          waterModule.endOfDay(s, k, bus, day, clock);
          this.dayIdx++;
        }
        this.hourOfDay = (h + 1) % 24;
      }
    },
    days(n, drive) {
      this.step(24 * n, drive);
    },
  };
  return rig;
}

/** First-order response of glycogen (g) toward `target` with time constant `tauH` hours, as fuel would deliver it. */
export function glycogenTo(current: number, target: number, tauH: number): number {
  return target + (current - target) * Math.exp(-1 / tauH);
}
