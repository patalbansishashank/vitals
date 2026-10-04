import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SleepRecord } from '@/biometrics/core/types';
import { RingBatteryLine, ringBatteryText } from '@/features/settings/devices/RingBatteryLine';
import { DayLine } from '../DayLine';
import { NightStages } from '../NightStages';
import { nightModel, runsOf } from '../ringData';
import { ringViewFor } from '@/features/living/progress/ring/RingSections';

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
    // unknown is hatched (never light), the unknown row is always there, segments are at least 1 px wide
    expect(document.querySelector<SVGRectElement>('rect[data-stage="unknown"]')!.style.fill).toMatch(/url\("?#sl-hatch/);
    expect(document.querySelectorAll('.lv-ring-rows > g > text')).toHaveLength(5);
    expect([...document.querySelectorAll('rect.lv-ring-stage')].every((r) => Number(r.getAttribute('width')) >= 1)).toBe(true);
    expect(screen.queryByText('Your ring recorded when you slept but not the stages.')).toBeNull();
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
    // only unknown: the row is filled and the night says the stages were not recorded
    expect(document.querySelectorAll('rect[data-stage="unknown"]')).toHaveLength(1);
    expect(screen.getByText('Your ring recorded when you slept but not the stages.')).toBeTruthy();
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

// steps and workouts moved to the Activity tab (activityCharts.test.tsx, activityTab.test.tsx)

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
