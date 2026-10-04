import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DailyRecord, ResolvedDay, SleepRecord, WorkoutRecord } from '@/biometrics/core/types';
import { RingBatteryLine, ringBatteryText } from '@/features/settings/devices/RingBatteryLine';
import { DayLine, NightStages, StepsBars, WorkoutsTable } from '../RingViews';
import { nightModel, runsOf, stepsDays, workoutRows } from '../ringData';
import { ringViewFor } from '../RingSections';

const prov = { channel: 'file:lumen_archive' as const, recording_method: 'automatic' as const, modality: 'sensed' as const, ingested_at: '2026-10-01T00:00:00Z' };
const q = (flags: SleepRecord['quality']['flags'] = []) => ({ validation: 'vendor_proprietary' as const, confidence: null, flags });
const iso = (min: number) => new Date(Date.parse('2026-09-27T21:30:00Z') + min * 60_000).toISOString();

function sleep(stages: Array<[SleepRecord['stages'] extends Array<infer S> | undefined ? S extends { stage: infer N } ? N : never : never, number, number]>, flags: SleepRecord['quality']['flags'] = []): SleepRecord {
  return {
    kind: 'sleep', record_id: 's', version: 1, is_main: true, asleep_s: 400 * 60,
    time: { start: iso(0), end: iso(450), tz_offset_s: 7200, local_date: '2026-09-28' },
    provenance: prov, quality: q(flags),
    stages: stages.map(([stage, a, b]) => ({ stage, start: iso(a), end: iso(b) })),
  };
}

describe('night view', () => {
  const full = sleep([['awake', 0, 15], ['light', 15, 75], ['deep', 75, 125], ['rem', 125, 165], ['unknown', 165, 190], ['light', 210, 440], ['awake', 440, 450]]);

  it('shows bed and wake times, minutes per stage, unknown and uncovered time', () => {
    render(<NightStages night={nightModel(full)!} />);
    expect(screen.getByText(/in bed 23:30 · up 07:00/)).toBeTruthy();
    const table = screen.getByRole('table');
    const row = (s: string) => within(table).getByText(s, { selector: 'th *, th', exact: false }).closest('tr')!;
    expect(within(row('deep')).getByText('50')).toBeTruthy();
    expect(within(row('light')).getByText('290')).toBeTruthy();
    expect(within(row('unknown')).getByText('25')).toBeTruthy();
    expect(screen.getAllByText(/20 min with no stage recorded/).length).toBeGreaterThan(0);
    expect(document.querySelectorAll('rect[data-stage="unknown"]')).toHaveLength(1);
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/unknown 25 min/);
  });

  it('a night with no stage list shows zero minutes everywhere, not invented stages', () => {
    const m = nightModel({ ...full, stages: [] })!;
    expect(m.minutes).toEqual({ deep: 0, light: 0, rem: 0, awake: 0, unknown: 0 });
    expect(m.uncovered).toBe(450);
    render(<NightStages night={m} />);
    expect(document.querySelectorAll('rect.lv-ring-stage')).toHaveLength(0);
  });

  it('flags a provisional night and maps "asleep" without a stage to unknown', () => {
    const m = nightModel(sleep([['asleep_unspecified', 0, 60]], ['provisional_stages']))!;
    expect(m.minutes.unknown).toBe(60);
    render(<NightStages night={m} />);
    expect(screen.getByText(/stages may still change/)).toBeTruthy();
  });
});

describe('day line', () => {
  const from = Date.parse('2026-09-28T22:00:00Z');
  const to = from + 24 * 3_600_000;
  const pts = [0, 5, 10, 15, 120, 125, 130].map((m, i) => ({ t: from + m * 60_000, v: 60 + i }));

  it('empty: says so, draws nothing', () => {
    render(<DayLine points={[]} from={from} to={to} offsetS={7200} unit="bpm" title="x" hue="cardio" empty="No heart-rate readings for this day." />);
    expect(screen.getByText('No heart-rate readings for this day.')).toBeTruthy();
    expect(document.querySelector('svg')).toBeNull();
  });

  it('partial: breaks the line over a gap and marks the resting value', () => {
    render(<DayLine points={pts} from={from} to={to} offsetS={7200} unit="bpm" title="Mon" hue="cardio" empty="none" reference={{ value: 52, label: 'resting 52 bpm' }} />);
    expect(document.querySelectorAll('polyline')).toHaveLength(2);
    expect(screen.getByText('resting 52 bpm')).toBeTruthy();
    expect(screen.getByText(/breaks in the line are times with no readings/)).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/7 readings from 00:00 to 02:10/);
  });

  it('loading and failed states', () => {
    const { rerender } = render(<DayLine points={[]} status="loading" from={from} to={to} offsetS={0} unit="%" title="x" hue="recovery" empty="none" />);
    expect(screen.getByText(/loading readings/)).toBeTruthy();
    rerender(<DayLine points={[]} status="failed" from={from} to={to} offsetS={0} unit="%" title="x" hue="recovery" empty="none" />);
    expect(screen.getByText(/could not be read/)).toBeTruthy();
  });

  it('runsOf splits on gaps only', () => {
    expect(runsOf(pts, 20 * 60_000).map((r) => r.length)).toEqual([4, 3]);
  });
});

const day = (date: string, steps?: number, am?: number): ResolvedDay => ({
  localDate: date, sleeps: [], workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [],
  ...(steps !== undefined
    ? { daily: { kind: 'daily', record_id: date, version: 1, time: { tz_offset_s: 0, local_date: date }, provenance: prov, quality: q(), steps, ...(am !== undefined ? { active_min: { light: 0, moderate: am, vigorous: 0 } } : {}) } as DailyRecord }
    : {}),
});

describe('steps', () => {
  it('keeps missing days as missing and shows today with active minutes', () => {
    const d = stepsDays([day('2026-09-25', 7000), day('2026-09-27', 10400, 52), day('2026-10-01', 3100, 12)], '2026-10-01', 7);
    expect(d.map((x) => x.steps)).toEqual([7000, null, 10400, null, null, null, 3100]);
    render(<StepsBars days={d} today={d[6]!} />);
    expect(screen.getByText('today so far 3,100 steps')).toBeTruthy();
    expect(screen.getByText('· 12 active min', { exact: false, selector: 'p span' })).toBeTruthy();
    expect(document.querySelectorAll('[data-missing="true"]')).toHaveLength(4);
    expect(screen.getAllByText(/3 of 7 days recorded/).length).toBeGreaterThan(0);
    expect(screen.getByText(/average 32 active min/)).toBeTruthy();
  });

  it('empty range', () => {
    const d = stepsDays([], '2026-10-01', 28);
    render(<StepsBars days={d} today={d[27]!} />);
    expect(screen.getByText('no steps recorded today yet')).toBeTruthy();
    expect(screen.getByText('No steps recorded in this range.')).toBeTruthy();
  });
});

describe('workouts', () => {
  const w = (start: string, extra: Partial<WorkoutRecord>): WorkoutRecord => ({
    kind: 'workout', record_id: start, version: 1, exercise_type: 'running', active_duration_s: 2400,
    time: { start, end: start, tz_offset_s: 7200, local_date: start.slice(0, 10) }, provenance: prov, quality: { validation: 'measured', confidence: null, flags: [] }, ...extra,
  });

  it('lists newest first with dashes for what was not recorded', () => {
    const rows = workoutRows([w('2026-09-27T09:00:00Z', { exercise_type: 'walking', active_duration_s: 2100 }), w('2026-09-28T16:00:00Z', { hr_avg_bpm: 148, hr_max_bpm: 171, distance_m: 6100, active_duration_s: 2400 })]);
    render(<WorkoutsTable rows={rows} />);
    const body = screen.getAllByRole('row').slice(1);
    expect(within(body[0]!).getByText('run')).toBeTruthy();
    expect(within(body[0]!).getByText('6.10 km')).toBeTruthy();
    expect(within(body[0]!).getByText('148 bpm')).toBeTruthy();
    expect(within(body[0]!).getByText('Mon 28 Sep 18:00')).toBeTruthy();
    expect(within(body[1]!).getByText('walk')).toBeTruthy();
    expect(within(body[1]!).getAllByText('—')).toHaveLength(3);
    expect(within(body[1]!).getByText('35 min')).toBeTruthy();
  });

  it('empty', () => {
    render(<WorkoutsTable rows={[]} />);
    expect(screen.getByText(/No workouts recorded/)).toBeTruthy();
  });
});

describe('score detail routing and battery line', () => {
  it('maps scores to views', () => {
    expect(ringViewFor('sleep.tst')).toBe('night');
    expect(ringViewFor('hr.rhr_night')).toBe('hr');
    expect(ringViewFor('spo2.night')).toBe('vitals');
    expect(ringViewFor('temp.deviation')).toBe('vitals');
    expect(ringViewFor('hrv.status')).toBeNull();
  });

  it('battery line: full, partial, empty', () => {
    const now = new Date(2026, 8, 29, 13, 0).toISOString();
    const at = new Date(2026, 8, 29, 12, 35).toISOString();
    const last = new Date(2026, 8, 29, 12, 41).toISOString();
    expect(ringBatteryText({ battery: { percent: 64, at }, lastDataAt: last, now })).toBe('Battery 64 % at 12:35 · last data received 12:41');
    expect(ringBatteryText({ battery: { percent: 81, at: new Date(2026, 8, 27, 8, 0).toISOString() }, now })).toBe('Battery 81 % at 27 Sep 08:00');
    expect(ringBatteryText({ lastDataAt: new Date(2026, 8, 28, 22, 5).toISOString(), now })).toBe('last data received yesterday 22:05');
    const { container } = render(<RingBatteryLine now={now} />);
    expect(container.innerHTML).toBe('');
  });
});
