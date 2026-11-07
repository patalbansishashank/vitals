// @vitest-environment node
/**
 * D4-04: the energy-availability exposure ledger. The eating-day statistic keeps its explicit name (`eatingDayEa7` = the
 * legacy `ea7`, tier policy unchanged); calendar EA_7/EA_28 = Σ(EI − EEE_net)/Σ FFM_act over the known days of the
 * trailing calendar window, fast and rest days included, unclipped, with known-day coverage. 30 kcal/kg FFM/day is a
 * precautionary policy reference: logged concerns trigger review at any EA, and EA below 30 alone adds no fasting ban.
 *
 * The run uses the real loop with a scripted plant (body size, exercise, TDEE) and the safety module. The calendar trace
 * fields are optional in `SafetyTrace` (the core allocates them, W2-core); this harness allocates them up front so the
 * safety module's own computation is tested independently of the core's key list.
 */
import { describe, expect, it } from 'vitest';
import { runEngine } from '../../core/loop';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { defineModule } from '../../core/moduleKit';
import type { DayInput } from '../../types/inputs';
import type { AnyEngineModule, ModuleContext } from '../../types/module';
import type { RunOptions, SafetyTrace, SimulationResult } from '../../types/result';
import type { DayTemplate } from '../../types/schedule';
import { calendarEaSummary, eaExposureReview } from './constraints';
import { safetyModule } from './index';
import { SAFETY_EA_EXPOSURE_POLICY, SAFETY_EA_POLICY } from './params';
import { person, prog, sched } from './testkit';

const LEDGER_KEYS = ['eatingDayEa7', 'calendarEa7', 'calendarEa28', 'eaCoverage7', 'eaCoverage28', 'eiKcal', 'eeeNetKcal', 'ffmActKg', 'eaRawDaily', 'fatMassKg'] as const;

/** Allocates the optional ledger arrays on the run's trace (what a core recording them does). */
const allocator = defineModule<object, object>({
  id: 'moderators',
  specSection: 'test',
  dossiers: 'test',
  params: [],
  reads: [],
  writes: [],
  records: [],
  prepare: (ctx: ModuleContext) => {
    const t = ctx.safetyTrace as unknown as Record<string, Float32Array | undefined>;
    for (const k of LEDGER_KEYS) if (!t[k]) t[k] = new Float32Array(ctx.nDays).fill(Number.NaN);
    return {};
  },
  init: () => ({}),
});

interface Plant {
  ffmKg: (d: number) => number;
  /** Net session exercise energy of day d, kcal (charged at 17:00). */
  eee: (d: number) => number;
}

function plantModule(p: Plant): AnyEngineModule {
  return defineModule<{ since: number }>({
    id: 'composition',
    specSection: 'test',
    dossiers: 'test',
    params: [],
    reads: [],
    writes: [],
    records: [],
    init: () => ({ since: 3 }),
    stepHour: (s, _k, bus, hour, _day, clock) => {
      const d = Math.max(0, clock.day);
      bus.scaleWeightKg = p.ffmKg(d) + 18;
      s.since = hour.kcal > 50 ? 0 : s.since + 1;
      bus.hoursSinceIntakeH = s.since;
      bus.fedState = s.since <= 2 ? 1 : 0;
      bus.bhbMmolL = 0.2;
      bus.exSessionNetKcalH = clock.hourOfDay === 17 ? p.eee(d) : 0;
      bus.tissueEnergyKcalH = hour.kcal - 2600 / 24;
    },
    endOfDay: (_s, _k, bus, _day, clock) => {
      const d = Math.max(0, clock.day);
      bus.ffmActKg = p.ffmKg(d);
      bus.fatMassKg = 18;
      bus.tissueMassKg = p.ffmKg(d) + 18;
      bus.scaleWeightKg = p.ffmKg(d) + 18;
      bus.tdeeEstKcalD = 2600;
      bus.hungerIdx = 6;
      bus.ea7KcalKgFfm = 40;
    },
  }) as unknown as AnyEngineModule;
}

const MAN = person({ sex: 'male', ageYears: 30, heightCm: 180, weightKg: 78 });
const zero: DayTemplate = { ...prog('Z', 0), energy: { kind: 'zero' } };
/** A rest day of 0 kcal written as an ordinary day (no fast label). */
const zeroKcal: DayTemplate = prog('K', 0, { proteinG: 0, carbsG: 0 });
/** Three zero-intake rest days in every 7: days with d % 7 ∈ {2, 4, 6}. */
const isZero = (d: number) => d % 7 === 2 || d % 7 === 4 || d % 7 === 6;

function run(opts: { days?: number; zeroAsFast?: boolean; allEating?: boolean; plant?: Partial<Plant>; patch?: (days: DayInput[]) => void; options?: RunOptions } = {}): SimulationResult {
  const days = opts.days ?? 28;
  const rp = resolveProfile(MAN);
  const programs = [prog('E', 2700, { proteinG: 140, carbsG: 300 }), opts.zeroAsFast === false ? zeroKcal : zero];
  const compiled = compileSchedule(sched(days, programs, (d) => (!opts.allEating && isZero(d) ? 1 : 0)), rp);
  opts.patch?.(compiled.days);
  const plant: Plant = { ffmKg: () => 60, eee: (d) => (isZero(d) ? 0 : 250), ...opts.plant };
  return runEngine(rp, compiled, { record: 'none', burnInDays: 0, mode: 'simulate', ...(opts.options ?? {}) }, [
    allocator as unknown as AnyEngineModule,
    plantModule(plant),
    safetyModule as unknown as AnyEngineModule,
  ]);
}

const at = (t: SafetyTrace, k: (typeof LEDGER_KEYS)[number], d: number): number => (t[k] as Float32Array)[d]!;

describe('D4-04 calendar energy-availability exposure', () => {
  it('policy semantics are versioned beside the unchanged eating-day tier policy', () => {
    expect(SAFETY_EA_POLICY.version).toBe(2);
    expect(SAFETY_EA_EXPOSURE_POLICY).toMatchObject({ version: 2, referenceKcalPerKgFfm: 30, reference: 'precautionaryPolicy', fastDays: 'included', rawLedger: 'unclipped', missingIntake: 'excluded' });
  });

  it('regression: FFM 60 kg, four days EI 2700 / EEE 250 and three zero-intake rest days → eating-day EA 40.83, calendar EA_7 23.33', () => {
    const t = run().safety;
    for (let d = 7; d < 28; d++) {
      expect(at(t, 'calendarEa7', d), `day ${d}`).toBeCloseTo(23.33, 1);
      expect(at(t, 'eaCoverage7', d)).toBe(7);
      if (!isZero(d)) expect(at(t, 'eatingDayEa7', d), `day ${d}`).toBeCloseTo(40.83, 1);
      // the eating-day statistic is the legacy ea7 under its explicit name
      expect(Object.is(at(t, 'eatingDayEa7', d), t.ea7[d]!) || Math.abs(at(t, 'eatingDayEa7', d) - t.ea7[d]!) < 1e-6).toBe(true);
    }
    expect(at(t, 'calendarEa28', 27)).toBeCloseTo(23.33, 1);
    expect(at(t, 'eaCoverage28', 27)).toBe(28);
  });

  it('ledger conservation: Σ(EI − EEE_net) over every calendar day of the window equals the recorded numerator, fast days included', () => {
    const t = run().safety;
    for (const d of [10, 20, 27]) {
      let num = 0;
      let den = 0;
      for (let j = d - 6; j <= d; j++) {
        num += at(t, 'eiKcal', j) - at(t, 'eeeNetKcal', j);
        den += at(t, 'ffmActKg', j);
      }
      expect(at(t, 'calendarEa7', d)).toBeCloseTo(num / den, 3);
    }
  });

  it('a planned fast day stays in EA_7/EA_28: relabelling the zero days as ordinary days does not change the calendar exposure', () => {
    const fast = run().safety;
    const plain = run({ zeroAsFast: false }).safety;
    for (let d = 0; d < 28; d++) expect(at(fast, 'calendarEa7', d)).toBeCloseTo(at(plain, 'calendarEa7', d), 3);
    // while the eating-day statistic of the tier policy does depend on the label
    expect(Number.isNaN(fast.ea7[9]!)).toBe(true);
  });

  it('negative daily EA is kept raw (no clipping to the legacy sample bounds)', () => {
    const t = run({ plant: { eee: (d) => (isZero(d) ? 600 : 250) } }).safety;
    expect(at(t, 'eaRawDaily', 9)).toBeCloseTo(-600 / 60, 3);
    expect(at(t, 'calendarEa7', 13)).toBeCloseTo((4 * 2450 - 3 * 600) / 420, 1);
  });

  it('a changing FFM uses Σ FFM over the exact days (an FFM-weighted mean, not the mean of daily ratios)', () => {
    const ffm = (d: number) => 55 + 0.5 * d;
    const t = run({ plant: { ffmKg: ffm } }).safety;
    const d = 20;
    let num = 0;
    let den = 0;
    let meanRatio = 0;
    for (let j = d - 6; j <= d; j++) {
      const e = isZero(j) ? 0 : 2450;
      num += e;
      den += ffm(j);
      meanRatio += e / ffm(j) / 7;
    }
    expect(at(t, 'calendarEa7', d)).toBeCloseTo(num / den, 2);
    expect(Math.abs(num / den - meanRatio)).toBeGreaterThan(1e-3);
  });

  it('missing intake is excluded, never zero or reassuring: unknown days lower the coverage and the review reads incomplete', () => {
    const t = run({ patch: (days) => days.forEach((x, d) => isZero(d) && (x.coverage = { energy: 'unknown', exercise: 'complete' }, x.exerciseCoverageScope = 'actualDay')) }).safety;
    expect(at(t, 'eaCoverage7', 20)).toBe(4);
    // only the four known eating days: (4 × 2450)/(4 × 60)
    expect(at(t, 'calendarEa7', 20)).toBeCloseTo(40.83, 1);
    expect(Number.isNaN(at(t, 'eiKcal', 9))).toBe(true);
    expect(Number.isNaN(at(t, 'eaRawDaily', 9))).toBe(true);
    const s = calendarEaSummary(t, 20)!;
    expect(s.complete7).toBe(false);
    expect(eaExposureReview(s).status).toBe('incomplete');
    // a confirmed-zero day is known zero intake
    const z = run({ patch: (days) => days.forEach((x, d) => isZero(d) && (x.coverage = { energy: 'confirmedZero', exercise: 'confirmedZero' }, x.exerciseCoverageScope = 'actualDay')) }).safety;
    expect(at(z, 'eaCoverage7', 20)).toBe(7);
    expect(at(z, 'calendarEa7', 20)).toBeCloseTo(23.33, 1);
  });

  it('an invalid fat-free mass leaves that day out of calendar EA (no substitute denominator) while its known intake stays in the ledger', () => {
    const t = run({ plant: { ffmKg: (d) => (d === 10 ? 0.5 : 60) } }).safety;
    expect(Number.isNaN(at(t, 'eaRawDaily', 10))).toBe(true);
    expect(at(t, 'eiKcal', 10)).toBeCloseTo(2700, 0);
    expect(at(t, 'eaCoverage7', 12)).toBe(6);
  });

  it('summary and review: a repeated calendar pattern below the reference asks for review, with no probability and no new fasting ban', () => {
    const t = run().safety;
    const s = calendarEaSummary(t)!;
    expect(s.calendarEa7).toBeCloseTo(23.33, 1);
    expect(s.referenceKcalPerKgFfm).toBe(30);
    expect(s.calendarRunBelowReference).toBeGreaterThan(14);
    expect(s.daysBelowReference28).toBe(12);
    const r = eaExposureReview(s);
    expect(r).toMatchObject({ status: 'review', probability: null, newFastingProhibition: false });
    expect(r.reasons).toContain('repeatedCalendarEaBelowReference');
  });

  it('EA at or above the reference never overrides logged concerns', () => {
    const t = run({ allEating: true, plant: { eee: () => 0 } }).safety;
    const s = calendarEaSummary(t)!;
    expect(s.calendarEa7!).toBeCloseTo(45, 1);
    expect(eaExposureReview(s).status).toBe('none');
    for (const c of ['menstrualChange', 'persistentFatigue', 'performanceDecline', 'injury'] as const) {
      const r = eaExposureReview(s, [c]);
      expect(r.status).toBe('review');
      expect(r.reasons).toEqual([`concern:${c}`]);
      expect(r.probability).toBeNull();
    }
  });

  it('EA below 30 alone adds no fasting prohibition: the tier rules and the fast warnings are unchanged by the ledger', () => {
    const t = run();
    const ids = new Set(t.warnings.map((w) => w.id));
    // the zero days are 24-h fasts under the default tier: no new fast-tier warning comes from calendar EA
    expect([...ids].filter((id) => id.startsWith('W-F0'))).toEqual([...new Set(run({ zeroAsFast: true }).warnings.map((w) => w.id as string))].filter((id) => id.startsWith('W-F0')));
    expect(eaExposureReview(calendarEaSummary(t.safety)).newFastingProhibition).toBe(false);
  });

  it('snapshot continuation with the trailing rings equals the full replay', () => {
    const full = run({ options: { captureSnapshotAt: [14] } });
    const snap = full.snapshots![14]!;
    const resumed = run({ options: { initialSnapshot: snap } });
    for (let d = 14; d < 28; d++) {
      expect(at(resumed.safety, 'calendarEa7', d)).toBeCloseTo(at(full.safety, 'calendarEa7', d), 5);
      expect(at(resumed.safety, 'calendarEa28', d)).toBeCloseTo(at(full.safety, 'calendarEa28', d), 5);
      expect(at(resumed.safety, 'eaCoverage28', d)).toBe(at(full.safety, 'eaCoverage28', d));
    }
  });
});
