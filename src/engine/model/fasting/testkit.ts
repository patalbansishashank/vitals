/**
 * Test kit for the fasting module (not imported by production code): builds a minimal ModuleContext, a hand-built
 * bus and drives `fastingModule` hour by hour exactly as the loop does (prepare → init → stepHour). Other modules are
 * replaced by hand-built signal trajectories (WP brief: modules are written in parallel).
 */
import { buildModelParams } from '../../core/paramsRegistry';
import type { DayInput, HourInput, CompiledSchedule } from '../../types/inputs';
import type { EventSink, ModuleContext, StepClock } from '../../types/module';
import type { ResolvedProfile } from '../../types/profile';
import type { SimEventType } from '../../types/events';
import { createSignalBus, type SignalBus } from '../../types/signals';
import { fastingModule, type FastingState } from './index';
import type { FastingConstants } from './model';

export interface RecordedEvent {
  type: SimEventType;
  hour: number;
  value: number;
}

export class EventLog implements EventSink {
  readonly list: RecordedEvent[] = [];
  emit(type: SimEventType, hourIndex: number, value: number): void {
    this.list.push({ type, hour: hourIndex, value });
  }
}

/** Baseline person as the fasting module sees it (the profile fields prepare/init read). */
export interface FastPerson {
  ffm0Kg: number;
  fm0Kg: number;
  tdee0Kcal: number;
  habitualProteinG: number;
  habitualCarbG: number;
}

export interface FastingRig {
  k: FastingConstants;
  s: FastingState;
  bus: SignalBus;
  hour: HourInput;
  day: DayInput;
  clock: StepClock;
  events: EventLog;
  /** Advance one hour with this hour's intake (kcal, protein g, carb g), plannedFast flag, the day's sodium (mg) and carbohydrate (g). */
  step(
    kcal: number,
    proteinG: number,
    carbG: number,
    plannedFast?: number,
    sodiumMg?: number,
    dayCarbG?: number,
  ): void;
}

export function makeRig(
  person: FastPerson,
  opts: {
    nDays?: number;
    fastSpans?: { startHour: number; endHour: number; electrolytes: boolean; mealToMealH?: number }[];
    paramOverrides?: Record<string, number>;
    checks?: boolean;
    startHour?: number;
    /** Build the bus with Object.fromEntries (V8 fast mode) instead of the core's keyed-store construction (dictionary mode). */
    fastBus?: boolean;
  } = {},
): FastingRig {
  const base = buildModelParams([fastingModule]);
  let params = base;
  if (opts.paramOverrides) {
    const values = new Float64Array(base.values);
    for (const [id, v] of Object.entries(opts.paramOverrides)) {
      const i = base.index.get(id);
      if (i === undefined) throw new Error(`unknown param ${id}`);
      values[i] = v;
    }
    params = { ...base, values };
  }
  const nDays = opts.nDays ?? 60;
  const schedule = {
    nDays,
    startDate: '2026-10-05',
    startWeekday: 0,
    days: [],
    fastSpans: opts.fastSpans ?? [],
    notes: [],
  } as unknown as CompiledSchedule;
  const events = new EventLog();
  const profile = person as unknown as ResolvedProfile;
  const ctx = {
    profile,
    params,
    schedule,
    nDays,
    mode: 'simulate',
    seriesEnabled: new Uint8Array(0),
    events,
    checks: opts.checks ?? true,
    safetyTrace: null,
  } as unknown as ModuleContext;
  const bus: SignalBus = opts.fastBus
    ? (Object.fromEntries(Object.entries(createSignalBus())) as SignalBus)
    : createSignalBus();
  bus.maintenanceKcalD = person.tdee0Kcal;
  bus.tdeeEstKcalD = person.tdee0Kcal;
  bus.fatMassKg = person.fm0Kg;
  bus.ffmActKg = person.ffm0Kg;
  bus.bhbMmolL = 0.1;
  bus.bhbEndoMmolL = 0.1;
  const k = fastingModule.prepare(ctx);
  const s = fastingModule.init(k, ctx, bus);
  const hour = { plannedFast: 0, kcal: 0, proteinG: 0, carbG: 0 } as unknown as HourInput;
  const day = { sodiumMg: 3000, carbG: 300 } as unknown as DayInput;
  const clock: StepClock = { day: 0, hourOfDay: 0, hourIndex: (opts.startHour ?? 0) - 1, weekday: 0 };
  const rig: FastingRig = {
    k,
    s,
    bus,
    hour,
    day,
    clock,
    events,
    step(kcal, proteinG, carbG, plannedFast = 0, sodiumMg = 3000, dayCarbG = 300) {
      clock.hourIndex += 1;
      clock.day = Math.floor(clock.hourIndex / 24);
      clock.hourOfDay = clock.hourIndex - 24 * clock.day;
      hour.kcal = kcal;
      hour.proteinG = proteinG;
      hour.carbG = carbG;
      hour.plannedFast = plannedFast;
      (day as { sodiumMg: number }).sodiumMg = sodiumMg;
      (day as { carbG: number }).carbG = dayCarbG;
      fastingModule.stepHour(s, k, bus, hour, day, clock);
    },
  };
  return rig;
}

/** Habitual eating pattern: three equal meals at 08, 13, 19 h of the given daily totals. */
export function mealAt(
  hourOfDay: number,
  kcalD: number,
  proteinD: number,
  carbD: number,
): [number, number, number] {
  if (hourOfDay === 8 || hourOfDay === 13 || hourOfDay === 19) return [kcalD / 3, proteinD / 3, carbD / 3];
  return [0, 0, 0];
}
