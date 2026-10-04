import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord, ResolvedDay, SleepRecord, SpotRecord } from '@/biometrics/core/types';
import { LivingClockContext, fixedClock } from '@/features/living/clock';
import { addDays } from '@/living/dates';
import { SignalsSourceProvider, type SeriesMetric, type SignalBaseline, type SignalsPerson, type SignalsSource } from '../../data';
import { FIXTURE_TODAY, browserTzOffsetS, createFixtureSignalsSource, fixtureClock } from '../../fixtures';
import { periodWindow, type PeriodKind } from '../../models';
import type { SeriesPoint } from '../../charts/ringData';
import { HeartTab } from '../HeartTab';

const MIN = 60_000;
const TODAY = '2026-10-03';
const prov = { channel: 'file:canonical' as const, recording_method: 'automatic' as const, modality: 'sensed' as const, ingested_at: '2026-10-01T00:00:00Z' };
const quality = { validation: 'measured' as const, confidence: null, flags: [] };
/** Local wall time → ms. */
const local = (date: string, h: number, m = 0) => {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, mo - 1, d, h, m).getTime();
};

function rd(date: string, fields: Partial<DailyRecord> | null, extra: Partial<ResolvedDay> = {}): ResolvedDay {
  return {
    localDate: date, sleeps: [], workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [],
    ...(fields ? { daily: { kind: 'daily', record_id: `d${date}`, version: 1, time: { tz_offset_s: 0, local_date: date }, provenance: prov, quality, ...fields } as DailyRecord } : {}),
    ...extra,
  };
}

function mainSleep(date: string): SleepRecord {
  const start = new Date(local(addDays(date, -1), 23)).toISOString();
  const end = new Date(local(date, 7)).toISOString();
  return { kind: 'sleep', record_id: `s${date}`, version: 1, is_main: true, asleep_s: 7 * 3600, time: { start, end, tz_offset_s: -new Date(local(date, 0)).getTimezoneOffset() * 60, local_date: date }, provenance: prov, quality };
}

function source(o: { days: ResolvedDay[]; series?: Partial<Record<SeriesMetric, SeriesPoint[]>>; baselines?: SignalBaseline[]; person?: Partial<SignalsPerson> }): SignalsSource {
  return {
    subscribe: () => () => {},
    revision: () => 0,
    days: (from, to) => o.days.filter((d) => d.localDate >= from && d.localDate <= to).sort((a, b) => (a.localDate < b.localDate ? -1 : 1)),
    series: async (metric, fromMs, toMs) => (o.series?.[metric] ?? []).filter((p) => p.t >= fromMs && p.t <= toMs),
    baselines: async () => o.baselines ?? [],
    firstDate: () => o.days[0]?.localDate ?? null,
    datesWithData: () => o.days.map((d) => d.localDate),
    person: () => ({ goals: {}, vendorScores: false, tempUnit: 'C', ...o.person }),
    sourceInfo: () => ({ labels: ['J-Style 2301'], lastReadAt: null }),
  };
}

async function show(src: SignalsSource, kind: PeriodKind, anchor: string, onDrill = vi.fn(), now = `${TODAY}T16:42`) {
  const utils = render(
    <LivingClockContext.Provider value={fixedClock(now)}>
      <SignalsSourceProvider source={src}>
        <HeartTab window={periodWindow(kind, anchor, TODAY)} today={TODAY} onDrill={onDrill} />
      </SignalsSourceProvider>
    </LivingClockContext.Provider>,
  );
  // let the series and baselines promises settle
  await act(async () => {
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  });
  return utils;
}

/** Heart rate every 5 min 06:00–07:55 rising 60 → 152, and 12:00–13:00 at 70. */
const hrDay = (date: string): SeriesPoint[] => [
  ...Array.from({ length: 24 }, (_, i) => ({ t: local(date, 6, i * 5), v: 60 + i * 4 })),
  ...Array.from({ length: 13 }, (_, i) => ({ t: local(date, 12, i * 5), v: 70 })),
];

const mainChart = () => document.querySelector('[data-axis="clock"]') as HTMLElement;
const tip = (el: ParentNode = document) => el.querySelector('.hr-tip')?.textContent ?? null;

describe('Heart and recovery · day', () => {
  it('heart rate through the day with zones, the resting line and labelled boundaries', async () => {
    const src = source({ days: [rd(TODAY, { resting_hr_bpm: 58 })], series: { hr: hrDay(TODAY) }, person: { ageYears: 40 } });
    await show(src, 'day', TODAY);
    const main = mainChart();
    expect(within(main).getByText('heart rate through the day')).toBeTruthy();
    expect(within(main).getByText('resting 58')).toBeTruthy();
    // max 180 (Tanaka at 40): zone 1 from 90, zone 2 from 108, zone 3 from 126
    expect(within(main).getByText('zone 2 · 108')).toBeTruthy();
    expect(main.querySelectorAll('polyline.hr-line[data-zone="3"]').length).toBeGreaterThan(0);
    expect(main.querySelector('[data-readouts]')!.textContent).toMatch(/resting 58\sbpm · lowest 60\sbpm \(06:00\) · highest 152\sbpm \(07:55\) · 37 readings/);
    expect(within(main).getByRole('img', { name: /Time in zones/ })).toBeTruthy();
    expect(screen.queryByText(/Add your age/)).toBeNull();
    // order of the day (§6.5–6.8)
    const titles = [...document.querySelectorAll('.sg-chart__title, .lv-ring-title')].map((e) => e.textContent);
    expect(titles).toEqual(['heart rate through the day', 'heart-rate variability last night', 'blood oxygen at night', 'skin temperature at night']);
    expect(document.querySelectorAll('.sp-pair')).toHaveLength(1);
    // the tier note is said once, by the page's source line, not again inside the tab
    expect(screen.queryByText(/shown as change from your own normal/)).toBeNull();
  });

  it('no age: a plain line and the age line', async () => {
    await show(source({ days: [rd(TODAY, { resting_hr_bpm: 58 })], series: { hr: hrDay(TODAY) } }), 'day', TODAY);
    const main = mainChart();
    expect(within(main).getByText('Add your age in Your body to see effort zones.')).toBeTruthy();
    expect([...main.querySelectorAll('polyline.hr-line')].every((p) => p.getAttribute('data-zone') === 'plain')).toBe(true);
  });

  it('a gap breaks the line', async () => {
    await show(source({ days: [rd(TODAY, {})], series: { hr: hrDay(TODAY) }, person: { ageYears: 40 } }), 'day', TODAY);
    const runs = new Set([...mainChart().querySelectorAll('polyline.hr-line')].map((p) => p.getAttribute('data-run')));
    expect(runs.size).toBe(2);
  });

  it('empty day: the copy, the frame kept, the night says so', async () => {
    await show(source({ days: [] }), 'day', '2026-10-01');
    expect(screen.getByText('No heart-rate readings for this day.')).toBeTruthy();
    expect(mainChart().querySelector('svg')).toBeTruthy();
    expect(screen.getAllByText('No night recorded.')).toHaveLength(2);
    expect(screen.getByText('No heart-rate variability recorded last night.')).toBeTruthy();
  });

  it('the now-hand only on today', async () => {
    const src = source({ days: [rd(TODAY, {}), rd('2026-10-02', {})], series: { hr: [...hrDay('2026-10-02'), ...hrDay(TODAY)] }, person: { ageYears: 40 } });
    const { unmount } = await show(src, 'day', TODAY);
    expect(mainChart().querySelectorAll('[data-mark="now"]')).toHaveLength(1);
    unmount();
    await show(src, 'day', '2026-10-02');
    expect(mainChart().querySelector('[data-mark="now"]')).toBeNull();
  });

  it('crosshair readout via the keyboard', async () => {
    await show(source({ days: [rd(TODAY, { resting_hr_bpm: 58 })], series: { hr: hrDay(TODAY) }, person: { ageYears: 40 } }), 'day', TODAY);
    const plot = mainChart().querySelector('.hr-plot') as HTMLElement;
    fireEvent.focus(plot);
    expect(tip(mainChart())).toMatch(/^13:00 · 70\sbpm · resting range$/);
    fireEvent.keyDown(plot, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(plot, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(plot, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(plot, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(plot, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(plot, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(plot, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(plot, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(plot, { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    // 13:00 − 9 × 35 min − 5 min = 07:40
    expect(tip(mainChart())).toMatch(/^07:40 · 140\sbpm · zone 3 · moderate$/);
  });

  it('heart-rate variability: forming normal shows the count and only the value', async () => {
    const days = Array.from({ length: 9 }, (_, i) => rd(addDays(TODAY, -i), { hrv: { metric: 'rmssd', value_ms: 48 + (i % 3), window: 'night' } }));
    await show(source({ days }), 'day', TODAY);
    expect(screen.getByText('Building your normal: 9 of 14 nights.')).toBeTruthy();
    expect(screen.getByText(/^48\sms last night$/)).toBeTruthy();
    expect(document.querySelector('.lv-gauge')).toBeNull();
  });

  it('heart-rate variability against the normal from bio.baselines', async () => {
    const days = [rd(TODAY, { hrv: { metric: 'rmssd', value_ms: 48, window: 'night' } })];
    const baselines: SignalBaseline[] = [{ metric: 'hrv_rmssd_ms', unit: 'ms', mean: 54, lo: 41, hi: 57, nights: 30, forming: false }];
    await show(source({ days, baselines }), 'day', TODAY);
    expect(screen.getByText(/^48\sms last night · −6\sms from your normal \(41–57\sms\)$/)).toBeTruthy();
    expect(document.querySelector('.lv-gauge')).toBeTruthy();
  });

  it('skin temperature at night as change from normal, "your normal" line, absolute only in the table', async () => {
    const history = Array.from({ length: 14 }, (_, i) => rd(addDays(TODAY, -1 - i), { skin_temp_c: 34.3 }));
    const night = mainSleep(TODAY);
    const today = rd(TODAY, { skin_temp_c: 34.5 }, { mainSleep: night, sleeps: [night] });
    const temps = [0, 60, 120, 180].map((m, i) => ({ t: local('2026-10-02', 23) + m * MIN, v: 34.4 + i * 0.1 }));
    await show(source({ days: [...history, today], series: { skin_temp: temps, spo2: temps.map((p) => ({ t: p.t, v: 96 })) } }), 'day', TODAY);
    const face = screen.getByText('skin temperature at night').closest('.lv-ring-day') as HTMLElement;
    expect(within(face).getByText('your normal')).toBeTruthy();
    expect(within(face).getByText(/average \+0\.3\s°C from your normal · highest \+0\.4\s°C at 02:00/)).toBeTruthy();
    expect(face.textContent).not.toMatch(/34\.7/);
    fireEvent.click(within(face).getByRole('button', { name: /^Show .* data table$/ }));
    expect(within(within(face).getByRole('table')).getByText('34.7')).toBeTruthy();
    // blood oxygen while its normal forms (no spo2 history): the absolute line and the night count
    expect(screen.getByText(/average 96\s% · lowest 96\s% at 23:00/)).toBeTruthy();
    const ox = screen.getByText('blood oxygen at night').closest('.hr-face') as HTMLElement;
    expect(within(ox).getByText('Building your normal: 0 of 14 nights.')).toBeTruthy();
    // a sleep band behind the day line
    expect(mainChart().querySelector('[data-band="sleep"]')).toBeTruthy();
  });

  it('blood oxygen at night as change from normal (tier C, as skin temperature): "your normal" line, absolute only in the table', async () => {
    const night = mainSleep(TODAY);
    const days = [rd(TODAY, { spo2_avg_pct: 96 }, { mainSleep: night, sleeps: [night] })];
    const baselines: SignalBaseline[] = [{ metric: 'spo2_avg_pct', unit: '%', mean: 97, lo: 96, hi: 98, nights: 30, forming: false }];
    const spo2 = [0, 60, 120, 180].map((m, i) => ({ t: local('2026-10-02', 23) + m * MIN, v: [96, 95, 93, 96][i]! }));
    await show(source({ days, baselines, series: { spo2 } }), 'day', TODAY);
    const face = screen.getByText('blood oxygen at night').closest('.lv-ring-day') as HTMLElement;
    expect(within(face).getByText('your normal')).toBeTruthy();
    // mean 95 against a 97 normal; the lowest reading is at 01:00
    expect(within(face).getByText(/^average −2\s% from your normal · lowest at 01:00$/)).toBeTruthy();
    expect(within(face).queryByText('Building your normal: 0 of 14 nights.')).toBeNull();
    const plot = face.querySelector('.hr-dl-plot') as HTMLElement;
    expect(plot.getAttribute('aria-label')).toMatch(/shown as change from your own normal/);
    expect(plot.getAttribute('aria-label')).not.toMatch(/tier C|93 %/);
    fireEvent.focus(plot);
    expect(tip(face)).toMatch(/^02:00 · −1\s% from your normal$/);
    // no absolute percentage and no 90–100 axis in the plain view
    const plain = face.textContent ?? '';
    expect(plain).not.toMatch(/9[0-9]\s?%/);
    expect([...face.querySelectorAll('.lv-ring-tick')].map((e) => e.textContent)).not.toContain('95');
    fireEvent.click(within(face).getByRole('button', { name: /^Show .* data table$/ }));
    const t = within(face).getByRole('table');
    expect(within(t).getByText('93')).toBeTruthy();
    expect(within(t).getByText('−4')).toBeTruthy();
  });

  it('your ring says: only when vendor scores are on', async () => {
    const days = [rd(TODAY, { vendor: { stress: { value: 34, scale: '0-100' }, readiness: 71 } })];
    const { unmount } = await show(source({ days }), 'day', TODAY);
    expect(screen.queryByText('your ring says')).toBeNull();
    unmount();
    await show(source({ days, person: { vendorScores: true } }), 'day', TODAY);
    expect(screen.getByText('your ring says')).toBeTruthy();
    expect(screen.getByText('stress 34 (their estimate)')).toBeTruthy();
    expect(screen.getByText('readiness 71 (their estimate)')).toBeTruthy();
  });

  it('spot checks draw as dots', async () => {
    const spot: SpotRecord = { kind: 'spot', record_id: 'sp', version: 1, metric: 'hr_bpm', value: 77, time: { at: new Date(local(TODAY, 15)).toISOString(), tz_offset_s: 0, local_date: TODAY }, provenance: prov, quality };
    await show(source({ days: [rd(TODAY, {}, { spots: [spot] })], series: { hr: hrDay(TODAY) }, person: { ageYears: 40 } }), 'day', TODAY);
    expect(mainChart().querySelectorAll('[data-mark="spot"]')).toHaveLength(1);
  });
});

describe('Heart and recovery · week, month, year', () => {
  // week of Mon 28 Sep – Sun 4 Oct; today Sat 3 Oct; 30 Sep has no record
  const weekDays = [
    rd('2026-09-28', { resting_hr_bpm: 58, hr_min_bpm: 48, hr_max_bpm: 150, spo2_avg_pct: 96, spo2_min_pct: 91 }),
    rd('2026-09-29', { resting_hr_bpm: 60, hr_min_bpm: 52, hr_max_bpm: 162 }),
    rd('2026-10-01', { hr_min_bpm: 55, hr_max_bpm: 120 }),
    rd('2026-10-02', { steps: 4000 }),
  ];

  it('heart rate per day: missing days are stubs, the average leaves them out and says so', async () => {
    await show(source({ days: weekDays }), 'week', '2026-09-30');
    const main = document.querySelector('[data-period="week"] .hr-face') as HTMLElement;
    expect(within(main).getByText('heart rate per day')).toBeTruthy();
    expect(main.querySelector('[data-readouts]')!.textContent).toMatch(/^resting average 59\sbpm \(recorded days\) · range 48–162$/);
    expect(main.querySelector('[data-coverage]')!.textContent).toBe('3 of 6 days recorded');
    // 30 Sep, 2 Oct (no heart-rate fields), 3 Oct are missing; 4 Oct is in the future
    expect(main.querySelectorAll('[data-missing="true"]')).toHaveLength(3);
    expect(main.querySelectorAll('[data-mark="dot"]')).toHaveLength(2);
    expect(main.querySelectorAll('[data-mark="range"]')).toHaveLength(3);
    const titles = [...document.querySelectorAll('.sg-chart__title')].map((e) => e.textContent);
    expect(titles).toEqual(['heart rate per day', 'resting heart rate', 'heart-rate variability', 'blood oxygen per night', 'skin temperature per night']);
    expect(document.querySelectorAll('.sp-pair')).toHaveLength(2);
  });

  it('drill-down: Enter on a day opens it; a month in the year opens the month', async () => {
    const onDrill = vi.fn();
    const { unmount } = await show(source({ days: weekDays }), 'week', '2026-09-30', onDrill);
    const plot = document.querySelector('[data-period="week"] .hr-face .hr-plot') as HTMLElement;
    fireEvent.focus(plot);
    expect(tip(plot)).toBe('Wed 30 Sep · no data');
    fireEvent.keyDown(plot, { key: 'ArrowLeft' });
    expect(tip(plot)).toMatch(/^Tue 29 Sep · resting 60\sbpm · 52–162\sbpm$/);
    fireEvent.keyDown(plot, { key: 'Enter' });
    expect(onDrill).toHaveBeenCalledWith('day', '2026-09-29');
    unmount();
    const onYear = vi.fn();
    await show(source({ days: weekDays }), 'year', TODAY, onYear);
    const yplot = document.querySelector('[data-period="year"] .hr-face .hr-plot') as HTMLElement;
    fireEvent.focus(yplot);
    fireEvent.keyDown(yplot, { key: 'ArrowLeft' });
    expect(tip(yplot)).toMatch(/^September 2026 · resting 59\sbpm \(mean\) · 48–162\sbpm · 2 days recorded$/);
    fireEvent.keyDown(yplot, { key: 'Enter' });
    expect(onYear).toHaveBeenCalledWith('month', '2026-09-01');
  });

  it('empty period keeps the frame and axes with one line', async () => {
    await show(source({ days: [] }), 'month', '2026-09-10');
    expect(screen.getByText('No heart rate recorded this month.')).toBeTruthy();
    const main = document.querySelector('[data-period="month"] .hr-face') as HTMLElement;
    expect(main.querySelector('svg')).toBeTruthy();
    expect(main.querySelectorAll('[data-missing="true"]')).toHaveLength(30);
  });

  it('skin temperature per night from the person’s normal; forming says so', async () => {
    const history = Array.from({ length: 20 }, (_, i) => rd(addDays('2026-09-27', -i), { skin_temp_c: 34.3 }));
    await show(source({ days: [...history, rd('2026-09-28', { skin_temp_c: 34.6 }), rd('2026-09-29', { skin_temp_c: 34.1 })] }), 'week', '2026-09-30');
    const face = screen.getByText('skin temperature per night').closest('.hr-face') as HTMLElement;
    expect(within(face).getByText('your normal')).toBeTruthy();
    expect(face.querySelectorAll('[data-mark="column"][data-sign="up"]')).toHaveLength(1);
    expect(face.querySelectorAll('[data-mark="column"][data-sign="down"]')).toHaveLength(1);
  });

  it('skin temperature with a forming normal', async () => {
    await show(source({ days: [rd('2026-09-28', { skin_temp_c: 34.6 })] }), 'week', '2026-09-30');
    const face = screen.getByText('skin temperature per night').closest('.hr-face') as HTMLElement;
    expect(within(face).getByText('Building your normal: 1 of 14 nights.')).toBeTruthy();
    expect(face.querySelector('[data-mark="column"]')).toBeNull();
  });

  it('blood oxygen per night as change from the person’s normal; absolute only in the table', async () => {
    const baselines: SignalBaseline[] = [{ metric: 'spo2_avg_pct', unit: '%', mean: 97, lo: 96, hi: 98, nights: 30, forming: false }];
    await show(source({ days: weekDays, baselines }), 'week', '2026-09-30');
    const face = screen.getByText('blood oxygen per night').closest('.hr-face') as HTMLElement;
    expect(within(face).getByText('your normal')).toBeTruthy();
    expect(face.querySelector('[data-coverage]')!.textContent).toMatch(/^1 of 6 nights recorded · average −1\s% from your normal \(recorded nights\)$/);
    expect(face.querySelectorAll('[data-mark="dot"]')).toHaveLength(1);
    expect(face.querySelector('[role="img"]')!.getAttribute('aria-label')).toMatch(/shown as change from your own normal/);
    expect(face.querySelector('.sg-chart__frame')!.textContent).not.toMatch(/\b9[0-9]\b/);
    const plot = face.querySelector('.hr-plot') as HTMLElement;
    fireEvent.focus(plot);
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(tip(plot)).toMatch(/^Mon 28 Sep · average −1\s% from your normal · lowest −6\s%$/);
    expect(within(face).queryByText(/Building your normal/)).toBeNull();
    fireEvent.click(within(face).getByRole('button', { name: /^Show .* data table$/ }));
    const row = within(within(face).getByRole('table')).getAllByRole('row')[1]!;
    expect(row.textContent).toBe('Mon 28 Sep9691−1');
  });

  it('blood oxygen per night while the normal forms: the absolute chart and the night count', async () => {
    await show(source({ days: weekDays }), 'week', '2026-09-30');
    const face = screen.getByText('blood oxygen per night').closest('.hr-face') as HTMLElement;
    expect(within(face).queryByText('your normal')).toBeNull();
    expect(within(face).getByText('Building your normal: 1 of 14 nights.')).toBeTruthy();
    expect(face.querySelector('[data-coverage]')!.textContent).toMatch(/average 96\s% \(recorded nights\)/);
  });

  it('your ring says per day, only when on', async () => {
    const days = [...weekDays, rd('2026-09-27', null), rd('2026-09-30', { vendor: { stress: { value: 34, scale: '0-100' } } })];
    await show(source({ days, person: { vendorScores: true } }), 'week', '2026-09-30');
    expect(screen.getByText('Wed 30 Sep · stress 34 (their estimate)')).toBeTruthy();
  });
});

describe('Heart and recovery · the synthetic fixtures', () => {
  const opts = { today: FIXTURE_TODAY, tzOffsetS: browserTzOffsetS };
  const showFixture = async (src: SignalsSource, kind: PeriodKind) => {
    const utils = render(
      <LivingClockContext.Provider value={fixtureClock()}>
        <SignalsSourceProvider source={src}>
          <HeartTab window={periodWindow(kind, FIXTURE_TODAY, FIXTURE_TODAY)} today={FIXTURE_TODAY} onDrill={vi.fn()} />
        </SignalsSourceProvider>
      </LivingClockContext.Provider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    return utils;
  };

  it('full: every period renders its five charts with data, and no zero stands in for a missing day', async () => {
    const src = createFixtureSignalsSource('full', opts);
    for (const kind of ['day', 'week', 'month', 'year'] as const) {
      const { unmount, container } = await showFixture(src, kind);
      const tab = container.querySelector(`[data-period="${kind}"]`)!;
      expect(tab).toBeTruthy();
      expect(tab.querySelectorAll('.hr-face').length).toBeGreaterThanOrEqual(kind === 'day' ? 4 : 5);
      if (kind === 'day') {
        expect(tab.querySelectorAll('polyline.hr-line').length).toBeGreaterThan(1);
        expect(tab.querySelectorAll('[data-mark="now"]')).toHaveLength(1);
        expect(within(tab as HTMLElement).queryByText('Add your age in Your body to see effort zones.')).toBeNull();
      } else {
        expect(tab.querySelectorAll('[data-mark="dot"]').length).toBeGreaterThan(0);
        // Thu 1 Oct has no record at all: drawn as missing in the week and the month
        if (kind !== 'year') expect(tab.querySelectorAll('[data-missing="true"]').length).toBeGreaterThan(0);
      }
      expect(container.textContent).not.toMatch(/NaN|undefined/);
      // J6-10: the internal tier name never reaches the words on screen or the chart descriptions
      expect(container.innerHTML).not.toMatch(/tier\s*C/i);
      // J6-03: the fixture's normal has formed, so blood oxygen is change from it, never an absolute percentage
      const ox = [...container.querySelectorAll('.hr-face')].find((f) => /blood oxygen/.test(f.querySelector('.sg-chart__title, .lv-ring-title')?.textContent ?? ''))!;
      expect(ox.querySelector('[data-mark="zero"]')).toBeTruthy();
      expect(ox.textContent).not.toMatch(/\b9\d(\.\d)?\s?%/);
      unmount();
    }
  });

  it('noAge: the plain line; vendor: the ring’s estimates listed; empty: the one line per chart', async () => {
    let r = await showFixture(createFixtureSignalsSource('noAge', opts), 'day');
    expect(screen.getByText('Add your age in Your body to see effort zones.')).toBeTruthy();
    r.unmount();
    r = await showFixture(createFixtureSignalsSource('vendor', opts), 'day');
    expect(screen.getByText('your ring says')).toBeTruthy();
    expect(screen.getAllByText(/\(their estimate\)/).length).toBeGreaterThan(0);
    r.unmount();
    r = await showFixture(createFixtureSignalsSource('empty', opts), 'week');
    expect(screen.getByText('No heart rate recorded this week.')).toBeTruthy();
    expect(screen.getAllByText('No nights recorded this week.').length).toBe(2);
    r.unmount();
  });
});
