// @vitest-environment node
/** energyDay against an engine run (energy SPEC §V2.6, notes C04, D15). */
import { describe, expect, it } from 'vitest';
import { simulate } from '@/engine/core/loop';
import { resolveProfile } from '@/engine/core/resolveProfile';
import { MAN, PROGRAM_B } from '@/engine/core/__tests__/fixtures';
import type { CardioSession, DayTemplate, Schedule } from '@/engine/types/schedule';
import { ENERGY_COMPONENTS, energyDay, energyToday, hoursFromRun, type EnergyHour, type EnergyMinute } from '../energyDay';

const MIN = 60_000;
const DAY0 = Date.UTC(2026, 9, 20, 0, 0, 0);
const WALK: CardioSession = { kind: 'cardio', modality: 'walk', startH: 7, durationMin: 45, speedKmh: 5.5, healthIntensityClass: 'moderate', healthClassSource: 'stated' };
const tmpl = (ex: CardioSession[]): DayTemplate => ({
  id: 'T',
  label: 'day',
  energy: { kind: 'pctMaintenance', pct: 90 },
  macros: { protein: { unit: 'gPerKgBw', value: 1.8 }, carbs: { unit: 'remainder' }, fat: { unit: 'gPerKgBw', value: 0.9 } },
  meals: { count: 3, window: { startH: 8, lengthH: 11 } },
  exercise: ex,
  steps: 9000,
});
const run = (ex: CardioSession[]) => {
  const sched: Schedule = { schemaVersion: 1, startDate: '2026-10-19', horizonDays: 3, programs: [tmpl(ex), PROGRAM_B], days: [{ program: 0 }, { program: 0 }, { program: 0 }] };
  return simulate(resolveProfile(MAN), sched, { record: 'full' });
};
const minutesOf = (f: (k: number) => EnergyMinute): EnergyMinute[] => Array.from({ length: 1440 }, (_, k) => f(k));
const awakeSteps = (k: number): EnergyMinute => (k < 7 * 60 || k >= 23 * 60 ? { sleep: 'asleep', steps: 0, support: 'minute' } : { sleep: 'none', steps: k % 10 === 0 ? 120 : 4, support: 'minute' });

describe('energyDay conservation against an engine run', () => {
  const r = run([WALK]);
  const hours = hoursFromRun(r.hourly as never, 24, 24, DAY0);
  const bout = { id: 'walk', window: { start: DAY0 + 7 * 60 * MIN, end: DAY0 + (7 * 60 + 45) * MIN }, incrementalKcalPerMin: 3.5, envelope: { lo: 150, hi: 250 } };
  const d = energyDay({ hours, minutes: minutesOf(awakeSteps), bouts: [bout] });

  it('Σ minutes = the engine tdee for every hour (≤ 0.1 %), and over the day', () => {
    expect(d.maxHourMismatchPct).toBeLessThanOrEqual(0.1);
    expect(d.total).toBeCloseTo(hours.reduce((a, h) => a + h.tdee, 0), 6);
    for (let h = 0; h < 24; h++) {
      const bins = d.bins15.slice(h * 4, h * 4 + 4).reduce((a, b) => a + b.kcal, 0);
      expect(Math.abs(bins - hours[h]!.tdee)).toBeLessThanOrEqual(Math.abs(hours[h]!.tdee) * 1e-3);
    }
  });

  it('no component is allocated twice: each component sums to its hourly series', () => {
    const sum = (k: keyof EnergyHour) => hours.reduce((a, h) => a + (h[k] as number), 0);
    expect(d.components.rmr).toBeCloseTo(sum('rmr'), 6);
    expect(d.components.tef).toBeCloseTo(sum('tef'), 6);
    expect(d.components.neatBase + d.components.stepsEnergy).toBeCloseTo(sum('neat'), 6);
    expect(d.components.stepsEnergy).toBeCloseTo(sum('stepsEnergy'), 6);
    expect(d.components.exercise + d.components.recovery).toBeCloseTo(sum('exerciseEnergy'), 6);
    const all = ENERGY_COMPONENTS.reduce((a, c) => a + d.components[c], 0);
    expect(all).toBeCloseTo(d.total, 6);
    const states = Object.values(d.byState).reduce((a, s) => a + s.kcal, 0);
    expect(states).toBeCloseTo(d.total, 6);
  });

  it('exercise state covers the approved bout; recovery is the tail after it; active follows D15', () => {
    expect(d.byState.exercise.minutes).toBe(45);
    expect(d.components.exercise).toBeGreaterThan(0);
    expect(d.components.exercise).toBeLessThanOrEqual(3.5 * 45 + 1e-6);
    expect(d.recovery).toBeCloseTo(d.components.recovery, 9);
    expect(d.active).toBeCloseTo(d.components.neatBase + d.components.stepsEnergy + d.components.exercise, 9);
    expect(d.active).toBeLessThan(d.total - d.rest);
    // bout envelopes add linearly to the RMR scenario
    expect(d.envelope.hi - d.total).toBeCloseTo(0.15 * d.rest + 50, 6);
    expect(d.uncertaintyKind).toBe('scenario');
  });

  it('gaps are the unknown state, never resting', () => {
    const gap = energyDay({ hours, minutes: minutesOf((k) => (k >= 600 && k < 720 ? { sleep: 'none', steps: null, support: null } : awakeSteps(k))), bouts: [bout] });
    expect(gap.byState.unknown.minutes).toBe(120);
    expect(gap.total).toBeCloseTo(d.total, 9);
    const empty = energyDay({ hours, minutes: [], bouts: [] });
    expect(empty.byState.unknown.minutes).toBe(1440);
    expect(empty.coverage.pct).toBe(0);
    expect(empty.total).toBeCloseTo(d.total, 9);
  });

  it('a 23-hour DST day keeps its observed length', () => {
    const short = energyDay({ hours: hours.slice(0, 23), minutes: minutesOf(awakeSteps).slice(0, 23 * 60), bouts: [] });
    expect(short.bins15.length).toBe(92);
    expect(short.total).toBeCloseTo(hours.slice(0, 23).reduce((a, h) => a + h.tdee, 0), 6);
  });
});

describe('energyToday: one authority, the realised today run', () => {
  const r = run([WALK]);
  const hours = hoursFromRun(r.hourly as never, 24, 24, DAY0);
  it('soFar pro-rates the current hour; byBedtime includes the plan remainder; a partial today never zeroes the future', () => {
    const now = DAY0 + 14.5 * 3_600_000;
    const t = energyToday({ run: hours, now, planDay: { total: 2400, active: 520 } });
    const before = hours.slice(0, 14).reduce((a, h) => a + h.tdee, 0) + 0.5 * hours[14]!.tdee;
    expect(t.soFar).toBeCloseTo(before, 6);
    expect(t.byBedtime).toBeCloseTo(hours.reduce((a, h) => a + h.tdee, 0), 6);
    expect(t.byBedtime - t.soFar).toBeGreaterThan(0.3 * t.byBedtime);
    expect(t.plan).toBe(2400);
    expect(t.planActive).toBe(520);
  });
});
