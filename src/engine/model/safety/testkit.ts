/**
 * safety — test harness (used only by the colocated tests).
 *
 * `runScenario` drives the real loop (`runEngine`) with two modules: a "plant" that plays the roles of the modules that
 * are not built yet (it writes the bus signals the safety module reads — fast counter, fed state, BHB, body-size
 * trajectories, TDEE, EA_7 as the wellbeing module would) and the safety module itself. Inputs come from real
 * `Schedule`s compiled by `core/compileSchedule`, so meals, fasts, refeed ramps, substances and hydration are realistic.
 * Per the WP brief the safety module is never run through the full 16-module loop here.
 */
import { runEngine } from '../../core/loop';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { defineModule } from '../../core/moduleKit';
import type { DayInput } from '../../types/inputs';
import type { PersonProfile, ResolvedProfile, SafetyFlags } from '../../types/profile';
import type { DayTemplate, FastEvent, Schedule } from '../../types/schedule';
import type { RunOptions, SimulationResult } from '../../types/result';
import type { AnyEngineModule } from '../../types/module';
import type { SimWarning } from '../../types/events';
import { safetyModule } from './index';

export const START = '2026-10-05';

export function person(
  p: Partial<PersonProfile['body']> &
    Pick<PersonProfile['body'], 'sex' | 'ageYears' | 'heightCm' | 'weightKg'>,
  safety?: { mode?: 'M0' | 'R1' | 'R2'; flags?: SafetyFlags },
  habits?: PersonProfile['habits'],
): PersonProfile {
  return {
    schemaVersion: 1,
    body: { ...p },
    startDate: START,
    ...(habits ? { habits } : {}),
    ...(safety ? { safety: { mode: safety.mode ?? 'M0', flags: safety.flags ?? {} } } : {}),
  };
}

export interface ProgOpts {
  proteinG?: number;
  carbsG?: number;
  /** g per 1000 kcal (default the engine's 8). */
  fibrePer1000?: number;
  meals?: DayTemplate['meals'];
  exercise?: DayTemplate['exercise'];
  hydration?: DayTemplate['hydration'];
  substances?: DayTemplate['substances'];
  modifiers?: DayTemplate['modifiers'];
  /** Percent of maintenance instead of absolute kcal. */
  pctMaintenance?: number;
}

/** A day program of `kcal` (or % of maintenance) with fixed protein and carbohydrate; fat takes the remainder. */
export function prog(id: string, kcal: number, o: ProgOpts = {}): DayTemplate {
  return {
    id,
    label: id,
    energy:
      o.pctMaintenance !== undefined
        ? { kind: 'pctMaintenance', pct: o.pctMaintenance }
        : { kind: 'kcal', kcal },
    macros: {
      protein: { unit: 'g', value: o.proteinG ?? 100 },
      carbs: { unit: 'g', value: o.carbsG ?? 200 },
      fat: { unit: 'remainder' },
      ...(o.fibrePer1000 !== undefined
        ? { fibre: { unit: 'gPer1000Kcal' as const, value: o.fibrePer1000 } }
        : {}),
    },
    ...(o.meals ? { meals: o.meals } : {}),
    ...(o.exercise ? { exercise: o.exercise } : {}),
    ...(o.hydration ? { hydration: o.hydration } : {}),
    ...(o.substances ? { substances: o.substances } : {}),
    ...(o.modifiers ? { modifiers: o.modifiers } : {}),
  };
}

export function sched(
  nDays: number,
  programs: DayTemplate[],
  dayProgram: (d: number) => number,
  events?: FastEvent[],
): Schedule {
  return {
    schemaVersion: 1,
    startDate: START,
    horizonDays: nDays,
    programs,
    days: Array.from({ length: nDays }, (_, d) => ({ program: dayProgram(d) })),
    ...(events ? { events } : {}),
  };
}

/** What the missing modules would put on the bus. All trajectories are functions of the day index (end-of-day values). */
export interface PlantSpec {
  /** TDEE estimate, kcal/d (default the profile's TDEE0). */
  tdee?: number | ((d: number) => number);
  /** Scale weight, kg (also tissue mass unless `tmKg` is given). */
  scaleKg: (d: number) => number;
  tmKg?: (d: number) => number;
  /** Body fat %, of scale weight (default: the profile's estimate). Ignored when `ffmKg` is given. */
  bfPct?: (d: number) => number;
  ffmKg?: (d: number) => number;
  hunger?: number;
  /** BHB by day and hour (default 0.2 mmol/L). */
  bhb?: (d: number, h: number) => number;
  /** Override the EA_7 the plant would compute (kcal/kg FFM/d). */
  ea7?: (d: number) => number;
  /** Session net exercise energy by day and hour, kcal (default: exercise minutes × netKcalPerMin). */
  exNet?: (d: number, h: number) => number;
  netKcalPerMin?: number;
  /** Force tissue energy sign (default: intake − TDEE/24 each hour). */
  tissueEnergy?: (d: number, h: number) => number;
  /**
   * composition's `fatFloorActive` (review M9). Default: its formula, 1 − clamp((FM − 0.02·BW0)/1 kg, 0, 1) while the
   * tissue energy is negative, else 0.
   */
  fatFloor?: (d: number, h: number) => number;
}

interface PlantState {
  hoursSince: number;
  dayEi: number;
  dayEee: number;
  eaRing: Float64Array;
  eaN: number;
}

function makePlant(spec: PlantSpec, rp: ResolvedProfile): AnyEngineModule {
  const tdeeAt = (d: number): number =>
    typeof spec.tdee === 'function' ? spec.tdee(d) : (spec.tdee ?? rp.tdee0Kcal);
  const plant = defineModule<PlantState>({
    id: 'composition',
    specSection: 'test',
    dossiers: 'test',
    params: [],
    reads: [],
    writes: [],
    records: [],
    // 20:00 dinner → midnight: the counter starts at 3 so that day 0 hour 0 reads 4 h (the real intake module reaches this state after burn-in)
    init: () => ({ hoursSince: 3, dayEi: 0, dayEee: 0, eaRing: new Float64Array(7), eaN: 0 }),
    stepHour: (s, _k, bus, hour, _day, clock) => {
      const d = Math.max(0, clock.day);
      // the scripted day's scale weight holds all day (safety reads the wake-hour value, morning anchor)
      bus.scaleWeightKg = spec.scaleKg(d);
      s.hoursSince = hour.kcal > 50 ? 0 : s.hoursSince + 1;
      bus.hoursSinceIntakeH = s.hoursSince;
      bus.fedState = s.hoursSince <= 2 ? 1 : 0;
      bus.bhbMmolL = spec.bhb ? spec.bhb(d, clock.hourOfDay) : 0.2;
      const net = spec.exNet ? spec.exNet(d, clock.hourOfDay) : hour.exMin * (spec.netKcalPerMin ?? 6);
      bus.exSessionNetKcalH = net;
      bus.exHardSession = hour.exMin > 0 && (hour.exIntensityFrac >= 0.85 || hour.rtToFailure > 0) ? 1 : 0;
      bus.tissueEnergyKcalH = spec.tissueEnergy
        ? spec.tissueEnergy(d, clock.hourOfDay)
        : hour.kcal - tdeeAt(d) / 24;
      if (spec.fatFloor) bus.fatFloorActive = spec.fatFloor(d, clock.hourOfDay);
      else {
        const fmMin = 0.02 * rp.weightKg;
        const x = (bus.fatMassKg - fmMin) / 1;
        bus.fatFloorActive = bus.tissueEnergyKcalH < 0 && x < 1 ? 1 - (x < 0 ? 0 : x) : 0;
      }
      s.dayEi += hour.kcal;
      s.dayEee += net;
    },
    endOfDay: (s, _k, bus, _day, clock) => {
      const d = Math.max(0, clock.day);
      const scale = spec.scaleKg(d);
      const tm = spec.tmKg ? spec.tmKg(d) : scale;
      bus.scaleWeightKg = scale;
      bus.tissueMassKg = tm;
      let ffm: number;
      let fm: number;
      if (spec.ffmKg) {
        ffm = spec.ffmKg(d);
        fm = tm - ffm;
      } else {
        fm = (scale * (spec.bfPct ? spec.bfPct(d) : rp.body.bodyFatPct)) / 100;
        ffm = tm - fm;
      }
      bus.fatMassKg = fm;
      bus.ffmActKg = ffm;
      bus.tdeeEstKcalD = tdeeAt(d);
      bus.hungerIdx = spec.hunger ?? 6;
      const ea = (s.dayEi - s.dayEee) / ffm;
      s.eaRing[s.eaN % 7] = ea;
      s.eaN++;
      const n = Math.min(7, s.eaN);
      let sum = 0;
      for (let i = 0; i < n; i++) sum += s.eaRing[i]!;
      bus.ea7KcalKgFfm = spec.ea7 ? spec.ea7(d) : sum / n;
      s.dayEi = 0;
      s.dayEee = 0;
    },
  });
  return plant as unknown as AnyEngineModule;
}

export interface ScenarioArgs {
  person: PersonProfile;
  schedule: Schedule;
  plant: PlantSpec;
  burnInDays?: number;
  mode?: RunOptions['mode'];
  /** Edit the compiled days before the run (substances, hydration and other fields the programs cannot express). */
  patchDays?: (days: DayInput[], rp: ResolvedProfile) => void;
  options?: RunOptions;
}

export interface Scenario {
  res: SimulationResult;
  rp: ResolvedProfile;
  ids: ReadonlySet<string>;
  warn: (id: string) => SimWarning[];
  has: (id: string) => boolean;
}

export function runScenario(a: ScenarioArgs): Scenario {
  const rp = resolveProfile(a.person);
  const compiled = compileSchedule(a.schedule, rp);
  a.patchDays?.(compiled.days, rp);
  const res = runEngine(
    rp,
    compiled,
    { record: 'none', burnInDays: a.burnInDays ?? 0, mode: a.mode ?? 'simulate', ...(a.options ?? {}) },
    [makePlant(a.plant, rp), safetyModule as unknown as AnyEngineModule],
  );
  const ids = new Set(res.warnings.map((w) => w.id as string));
  return { res, rp, ids, warn: (id) => res.warnings.filter((w) => w.id === id), has: (id) => ids.has(id) };
}

/** Linear trajectory helper: value at day d from `a` (d = 0) with slope `perDay`. */
export const linear =
  (a: number, perDay: number) =>
  (d: number): number =>
    a + perDay * d;
