import { describe, expect, it } from 'vitest';
import type { BioProvenance, DailyRecord, ResolvedDay, WorkoutRecord } from '@/biometrics/core/types';
import { periodWindow } from '../../models';
import { zoneModel } from '../zones';
import {
  activityDays,
  columnScale,
  compactTick,
  datesTouched,
  goalCount,
  goalMeterMax,
  goalMeterTicks,
  groupByDay,
  monthlyActivity,
  niceStep,
  recordedAverage,
  sleepBands,
  stepsByHour,
  workoutItems,
  workoutSource,
  workoutZoneMinutes,
} from '../activityModels';

const prov = (over: Partial<BioProvenance> = {}): BioProvenance => ({
  channel: 'ble:jstyle2301',
  recording_method: 'automatic',
  modality: 'sensed',
  ingested_at: '2026-10-01T00:00:00Z',
  device: { type: 'ring', tier: 'C' },
  ...over,
});
const quality = { validation: 'measured' as const, confidence: null, flags: [] };
const at = (y: number, mo: number, d: number, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const offsetAt = (t: number) => -new Date(t).getTimezoneOffset() * 60;

function day(date: string, daily?: Partial<DailyRecord>, workouts: WorkoutRecord[] = []): ResolvedDay {
  return {
    localDate: date,
    sleeps: [],
    workouts,
    spots: [],
    sourceByMetric: {},
    tierByMetric: {},
    basisByMetric: {},
    corrections: [],
    ...(daily
      ? {
          daily: {
            kind: 'daily',
            record_id: `d-${date}`,
            version: 1,
            time: { tz_offset_s: 0, local_date: date },
            provenance: prov(),
            quality,
            ...daily,
          } as DailyRecord,
        }
      : {}),
  };
}

function workout(
  id: string,
  start: number,
  minutes: number,
  extra: Partial<WorkoutRecord> = {},
): WorkoutRecord {
  const d = new Date(start);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    kind: 'workout',
    record_id: id,
    version: 1,
    exercise_type: 'running',
    active_duration_s: minutes * 60,
    time: {
      start: new Date(start).toISOString(),
      end: new Date(start + minutes * 60_000).toISOString(),
      tz_offset_s: offsetAt(start),
      local_date: date,
    },
    provenance: prov(),
    quality,
    ...extra,
  };
}

describe('goal meter domain (§7.5.1)', () => {
  it('with a goal: 0 → goal × 1.25 while the value is under it', () => {
    expect(goalMeterMax(6420, 8000)).toBe(10_000);
    expect(goalMeterMax(null, 8000)).toBe(10_000);
    expect(goalMeterMax(0, 8000)).toBe(10_000);
  });

  it('over the goal: value × 1.05 (the bar runs past the goal tick)', () => {
    expect(goalMeterMax(12_000, 8000)).toBeCloseTo(12_600);
  });

  it('no goal: value × 1.25; nothing to scale without a value', () => {
    expect(goalMeterMax(6420)).toBeCloseTo(8025);
    expect(goalMeterMax(null)).toBe(0);
    expect(goalMeterMax(0, undefined)).toBe(0);
    expect(goalMeterTicks(0)).toEqual([]);
  });

  it('ticks: minor every 10 % of the goal, majors at 0 and ½ goal, the goal tick', () => {
    const t = goalMeterTicks(10_000, 8000);
    expect(t.map((x) => x.v)).toEqual([
      0, 800, 1600, 2400, 3200, 4000, 4800, 5600, 6400, 7200, 8000, 8800, 9600,
    ]);
    expect(t.filter((x) => x.numeral).map((x) => x.v)).toEqual([0, 4000]);
    expect(t.filter((x) => x.goal).map((x) => x.v)).toEqual([8000]);
    expect(t.filter((x) => x.major).length).toBe(3);
  });

  it('ticks without a goal: nice steps, no goal tick', () => {
    const t = goalMeterTicks(8025);
    expect(t.some((x) => x.goal)).toBe(false);
    expect(t.filter((x) => x.major).map((x) => x.v)).toEqual([0, 5000]);
    expect(t.length).toBe(9);
  });
});

describe('steps by hour (§7.5.2)', () => {
  const pts = [
    { t: at(2026, 10, 1, 8, 10), v: 700 },
    { t: at(2026, 10, 1, 8, 40), v: 500 },
    { t: at(2026, 10, 1, 9, 0), v: 0 },
    { t: at(2026, 10, 1, 9, 30), v: 0 },
    { t: at(2026, 10, 1, 11, 30), v: 800 },
    { t: at(2026, 10, 1, 14, 10), v: 300 },
    { t: at(2026, 9, 30, 23, 50), v: 99 }, // the evening before: not this day
    { t: at(2026, 10, 1, 16, 5), v: 40 }, // after now (clock drift): dropped
  ];
  const hours = stepsByHour(pts, '2026-10-01', at(2026, 10, 1, 14, 30));

  it('sums samples per local hour; an hour without a sample is missing, a recorded 0 is 0', () => {
    expect(hours).toHaveLength(24);
    expect(hours[8]!.steps).toBe(1200);
    expect(hours[9]!.steps).toBe(0);
    expect(hours[10]!.steps).toBeNull();
    expect(hours[11]!.steps).toBe(800);
    expect(hours[23]!.steps).toBeNull();
  });

  it('hours after now are future (draw nothing); the current hour is not', () => {
    expect(hours[14]!.future).toBe(false);
    expect(hours[14]!.steps).toBe(300);
    expect(hours[15]!.future).toBe(true);
    expect(hours[16]!.future).toBe(true);
    expect(hours[16]!.steps).toBeNull();
  });

  it('sleep bands are clipped to the day', () => {
    const night = {
      time: {
        start: new Date(at(2026, 9, 30, 23, 30)).toISOString(),
        end: new Date(at(2026, 10, 1, 7, 0)).toISOString(),
        tz_offset_s: 0,
        local_date: '2026-10-01',
      },
    };
    const b = sleepBands([night as never], at(2026, 10, 1), at(2026, 10, 2));
    expect(b).toEqual([{ from: at(2026, 10, 1), to: at(2026, 10, 1, 7) }]);
  });
});

describe('days, averages and the goal count (§7.5.3)', () => {
  const w = periodWindow('week', '2026-10-01', '2026-10-01'); // Mon 28 Sep – Sun 4 Oct, today Thursday
  const days = [
    day('2026-09-28', { steps: 9000 }),
    day('2026-09-30', { steps: 7000, active_min: { light: 20, moderate: 10, vigorous: 4 } }),
    day('2026-10-01', { steps: 8500 }),
  ];
  const ad = activityDays(days, w.slots);

  it('a day without a record carries nulls; future days are flagged', () => {
    expect(ad.map((d) => d.steps)).toEqual([9000, null, 7000, 8500, null, null, null]);
    expect(ad.map((d) => d.future)).toEqual([false, false, false, false, true, true, true]);
    expect(ad[2]!.activeMin).toBe(34);
    expect(ad[0]!.activeMin).toBeNull();
  });

  it('averages leave missing days out (never counted as 0)', () => {
    const r = recordedAverage(ad.filter((d) => !d.future).map((d) => d.steps));
    expect(r.n).toBe(3);
    expect(r.avg).toBeCloseTo((9000 + 7000 + 8500) / 3);
    expect(recordedAverage([null, null]).avg).toBeNull();
  });

  it('"at goal on N of M days" counts only days up to today', () => {
    expect(goalCount(ad, (d) => d.steps, 8000, '2026-10-01')).toEqual({ at: 2, recorded: 3, elapsed: 4 });
    // a value on a future slot (the window was built for a later "today") still counts only up to today
    expect(goalCount(ad, (d) => d.steps, 8000, '2026-09-29')).toEqual({ at: 1, recorded: 1, elapsed: 2 });
    expect(goalCount(ad, (d) => d.steps, undefined, '2026-10-01').at).toBe(0);
  });
});

describe('months of a year (§7.5.3, §7.3.6)', () => {
  const w = periodWindow('year', '2026-10-01', '2026-10-01');
  const days = [
    day('2026-09-01', { steps: 6000 }),
    day('2026-09-02', { steps: 8000 }),
    day('2026-09-05', undefined, [workout('w1', at(2026, 9, 5, 9), 30)]),
    day('2026-10-01', { steps: 5000 }),
  ];
  const m = monthlyActivity(days, w.slots, '2026-10-01');

  it('average steps per recorded day, with coverage numerals over the days of the month up to today', () => {
    const sep = m[8]!;
    expect(sep.avgSteps).toBe(7000);
    expect(sep.recorded).toBe(2);
    expect(sep.days).toBe(30);
    expect(sep.workouts).toBe(1);
    const oct = m[9]!;
    expect(oct.current).toBe(true);
    expect(oct.days).toBe(1);
    expect(oct.recorded).toBe(1);
  });

  it('a month with no record is missing (null), a future month is future', () => {
    expect(m[0]!.avgSteps).toBeNull();
    expect(m[0]!.workouts).toBeNull();
    expect(m[0]!.days).toBe(31);
    expect(m[11]!.future).toBe(true);
    expect(m[11]!.days).toBe(0);
  });
});

describe('workouts (§7.5.4)', () => {
  it('source words come from provenance, never from a device name', () => {
    expect(workoutSource(prov())).toBe('ring');
    expect(workoutSource(prov({ channel: 'manual', recording_method: 'manual', device: undefined }))).toBe(
      'hand',
    );
    expect(workoutSource(prov({ channel: 'file:apple_health', device: { type: 'watch', tier: 'B' } }))).toBe(
      'import',
    );
  });

  it('rows newest first, grouped by day', () => {
    const ws = workoutItems([
      day('2026-09-28', undefined, [workout('a', at(2026, 9, 28, 7), 30)]),
      day('2026-09-30', undefined, [
        workout('b', at(2026, 9, 30, 7), 20),
        workout('c', at(2026, 9, 30, 18, 5), 38),
      ]),
    ]);
    expect(ws.map((w) => w.id)).toEqual(['c', 'b', 'a']);
    expect(groupByDay(ws).map((g) => [g.date, g.items.length])).toEqual([
      ['2026-09-30', 2],
      ['2026-09-28', 1],
    ]);
    expect(ws[0]!.end - ws[0]!.start).toBe(38 * 60_000);
  });

  it('time in zones over the workout window only', () => {
    const z = zoneModel({ ageYears: 40 })!; // max 180: zone 3 from 126, zone 4 from 144
    const start = at(2026, 9, 30, 18, 5);
    const pts = Array.from({ length: 39 }, (_, i) => ({ t: start + i * 60_000, v: i < 20 ? 130 : 150 }));
    const before = [{ t: start - 30 * 60_000, v: 170 }];
    expect(workoutZoneMinutes([...before, ...pts], { start, end: start + 38 * 60_000 }, z)).toEqual([
      0, 0, 0, 20, 18, 0,
    ]);
    expect(workoutZoneMinutes(pts, { start, end: start + 38 * 60_000 }, null)).toBeNull();
  });

  it('local dates a window touches (a workout over midnight reads both days)', () => {
    expect(datesTouched(at(2026, 9, 30, 23, 30), at(2026, 10, 1, 0, 20))).toEqual([
      '2026-09-30',
      '2026-10-01',
    ]);
  });
});

describe('scales', () => {
  it('nice steps and a ceiling that clears the goal', () => {
    expect(niceStep(2750)).toBe(5000);
    expect(niceStep(2750, true)).toBe(3000);
    expect(niceStep(2100)).toBe(2500);
    expect(columnScale(1840, undefined, 2, 1000)).toEqual({ max: 2000, ticks: [1000, 2000] });
    expect(columnScale(7000, 8000, 3, 10_000).max).toBeGreaterThanOrEqual(8400);
    expect(columnScale(0, undefined, 3, 10_000).max).toBeGreaterThanOrEqual(10_000);
    expect(compactTick(2500)).toBe('2.5k');
    expect(compactTick(600)).toBe('600');
  });
});
