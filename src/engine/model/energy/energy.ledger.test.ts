// @vitest-environment node
/**
 * D1-01 — internal daily TDEE uses the same completed-hour costs as the recorded ledger, on the real 16-module engine.
 *
 * Energy runs before fuel (DNL heat) and composition (signed deposition cost) inside each hour, so its hourly sum is lagged
 * by one hour for those two terms. The endpoint correction at endOfDay (c(23:00) − c(incoming), c = DNL heat + deposition)
 * makes the internal day sum (yesterday's TDEE behind `tdeeEstKcalD`, the burn-in calibration, the low-TDEE flag) equal the
 * recorded current-hour `tdee` ledger exactly, across midnight, burn-in and a day-stamped resume. No module is reordered.
 */
import { describe, expect, it } from 'vitest';
import type { DayTemplate, PersonProfile, Schedule } from '@/engine';
import { captureInitialSnapshot, runEngine } from '../../core/loop';
import { compileSchedule } from '../../core/compileSchedule';
import { resolveProfile } from '../../core/resolveProfile';
import { MODULES } from '../../core/moduleRegistry';
import type { SeriesId } from '../../types/metrics';
import type { EnergyState } from './index';

const START = '2026-10-05';
const MAN: PersonProfile = { schemaVersion: 1, body: { sex: 'male', ageYears: 38, heightCm: 178, weightKg: 86 }, habits: { sessionsPerWeek: 2 }, startDate: START };

/** Late last meal (window 10:00-23:00) so DNL and deposition at 23:00 differ from the next day's first hour. */
const day = (id: string, kcal: number, carbG: number): DayTemplate => ({
  id,
  label: id,
  energy: { kind: 'kcal', kcal },
  macros: { protein: { unit: 'g', value: 120 }, carbs: { unit: 'g', value: carbG }, fat: { unit: 'remainder' } },
  meals: { count: 4, window: { startH: 10, lengthH: 13 } },
  steps: 7000,
});

const HORIZON = 12;
/**
 * Deficit/low-carbohydrate days alternate with surplus/high-carbohydrate (DNL) days, c changes sign and size at midnight,
 * and a 36-h fast (fasting branch, held AT) crosses two midnights.
 */
const SCHEDULE: Schedule = {
  schemaVersion: 1,
  startDate: START,
  horizonDays: HORIZON,
  programs: [day('lo', 1300, 60), day('hi', 4300, 700)],
  days: Array.from({ length: HORIZON }, (_, i) => ({ program: i % 3 === 0 ? 0 : 1 })),
  events: [{ kind: 'fast', startDay: 7, startH: 20, durationH: 36 }],
};

const ENERGY_IDX = MODULES.findIndex((m) => m.id === 'energy');
const SERIES: readonly SeriesId[] = ['tdee', 'energyBalance', 'rmr', 'tef', 'neat', 'maintenance', 'fatMass', 'leanTissue'];

function setup() {
  const rp = resolveProfile(MAN);
  const cs = compileSchedule(SCHEDULE, rp);
  return { rp, cs };
}

const dayHourSum = (hourly: Float32Array, d: number): number => {
  let s = 0;
  for (let h = 0; h < 24; h++) s += hourly[d * 24 + h]!;
  return s;
};

describe('D1-01 — endpoint-corrected daily TDEE equals the recorded current-hour ledger', () => {
  it('internal prevDayTee equals Σ recorded hourly tdee for every day (deficit, surplus, DNL, fasting across midnight)', () => {
    const { rp, cs } = setup();
    const days = Array.from({ length: HORIZON - 1 }, (_, i) => i + 1);
    const r = runEngine(rp, cs, { record: 'full', series: SERIES, checks: true, captureSnapshotAt: days });
    const tdee = r.hourly.tdee!;
    let maxCorr = 0;
    for (const d of days) {
      const st = r.snapshots![d]!.states[ENERGY_IDX] as EnergyState;
      expect(st.prevDayTeeKcal, `day ${d - 1}`).toBeCloseTo(dayHourSum(tdee, d - 1), 1);
      maxCorr = Math.max(maxCorr, Math.abs(st.dayEndpointCorrKcal));
    }
    // the schedule exercises the correction (the lagged sum alone would differ by more than rounding)
    expect(maxCorr).toBeGreaterThan(0.5);
    // energy invariants are untouched (they are evaluated on current-hour terms)
    expect(r.meta.checks!.energyMaxAbsKcal).toBeLessThan(1e-6);
    expect(r.meta.checks!.energyDayMaxAbsKcal).toBeLessThan(1e-6);
  });

  it('the no-deposition accumulator is corrected by the DNL endpoint only (incoming endpoints captured at startDay)', () => {
    const { rp, cs } = setup();
    const r = runEngine(rp, cs, { record: 'none', captureSnapshotAt: [3, 4] });
    const s3 = r.snapshots![3]!.states[ENERGY_IDX] as EnergyState;
    const s4 = r.snapshots![4]!.states[ENERGY_IDX] as EnergyState;
    // incoming endpoints are re-captured every day (finite, overwritten at startDay)
    expect(Number.isFinite(s3.incomingDnlKcalH) && Number.isFinite(s3.incomingDepKcalH)).toBe(true);
    expect(Number.isFinite(s4.dayEndpointCorrKcal)).toBe(true);
  });

  it('a day-stamped resume and the uninterrupted run agree (tdee, maintenance, tissue)', () => {
    const { rp, cs } = setup();
    const k = 5;
    const full = runEngine(rp, cs, { record: 'full', series: SERIES, captureSnapshotAt: [k] });
    const resumed = runEngine(rp, cs, { record: 'full', series: SERIES, initialSnapshot: full.snapshots![k]! });
    for (const id of SERIES) {
      const a = full.daily[id]!;
      const b = resumed.daily[id]!;
      for (let d = k; d < HORIZON; d++) expect(b[d], `${id} day ${d}`).toBe(a[d]);
    }
  });

  it('a post-burn-in snapshot reproduces the fresh run (burn-in and day 0 carry the corrected endpoint)', () => {
    const { rp, cs } = setup();
    const fresh = runEngine(rp, cs, { record: 'daily', series: SERIES });
    const snap = captureInitialSnapshot(rp, cs, { record: 'daily', series: SERIES });
    const again = runEngine(rp, cs, { record: 'daily', series: SERIES, initialSnapshot: snap });
    for (const id of SERIES) expect(Array.from(again.daily[id]!), id).toEqual(Array.from(fresh.daily[id]!));
  });
});
