import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { DailyRecord, ResolvedDay, SleepRecord, SleepStageName } from '@/biometrics/core/types';
import { fixedClock, LivingClockContext } from '@/features/living/clock';
import { SignalsSourceProvider, type SeriesMetric, type SignalBaseline, type SignalsPerson, type SignalsSource } from '@/features/signals/data';
import type { SeriesPoint } from '@/features/signals/charts/ringData';
import { RingServiceProvider, type RingStatus } from '../data';
import { createFakeRingService, createFakeSharing, scenarioPlatform, type RingScenario } from '../fixtures';
import { TodayReadings } from '../TodayReadings';
import { ageText, fmtDuration, todayRows, type TodayInput } from '../todayModel';

const TODAY = '2026-10-04';
const NOW = new Date(`${TODAY}T13:41:00`).getTime();
const clock = fixedClock(`${TODAY}T13:41`);
const local = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`);
const iso = (date: string, hhmm: string) => local(date, hhmm).toISOString();
const off = (date: string, hhmm: string) => -local(date, hhmm).getTimezoneOffset() * 60;
const norm = (s: string | null | undefined) => (s ?? '').replace(/[\u2009\u00a0]/g, ' ');

const prov = { channel: 'ble:jstyle2301' as const, recording_method: 'automatic' as const, modality: 'sensed' as const, ingested_at: '2026-10-04T08:00:00Z' };
const quality = { validation: 'vendor_proprietary' as const, confidence: null, flags: [] };

function night(withUnknown = true): SleepRecord {
  const d0 = '2026-10-03', d1 = TODAY;
  const st = (stage: SleepStageName, a: [string, string], b: [string, string]) => ({ stage, start: iso(...a), end: iso(...b) });
  const stages = [
    st('light', [d0, '23:40'], [d1, '01:00']),
    st('deep', [d1, '01:00'], [d1, '02:30']),
    st(withUnknown ? 'unknown' : 'light', [d1, '02:30'], [d1, '03:11']),
    st('rem', [d1, '03:11'], [d1, '05:00']),
    st('light', [d1, '05:00'], [d1, '07:05']),
  ];
  return {
    kind: 'sleep', record_id: 'n1', version: 1, is_main: true, asleep_s: 432 * 60,
    time: { start: iso(d0, '23:40'), end: iso(d1, '07:05'), tz_offset_s: off(d1, '07:05'), local_date: d1 },
    provenance: prov, quality, stages,
  };
}

function daily(over: Partial<DailyRecord> = {}): DailyRecord {
  return {
    kind: 'daily', record_id: 'd1', version: 1, time: { tz_offset_s: off(TODAY, '12:00'), local_date: TODAY }, provenance: prov, quality,
    steps: 6420, active_min: { light: 20, moderate: 10, vigorous: 4 }, active_kcal: 280, resting_hr_bpm: 58,
    hrv: { metric: 'rmssd', value_ms: 48, window: 'night' }, spo2_avg_pct: 96, spo2_min_pct: 91, skin_temp_delta_c: 0.4,
    vendor: { sleep: 82, stress: { value: 34, scale: '0-100' } },
    ...over,
  };
}

function day(date: string, d?: DailyRecord, s?: SleepRecord): ResolvedDay {
  return { localDate: date, daily: d, mainSleep: s, sleeps: s ? [s] : [], workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [] };
}

const BASELINES: SignalBaseline[] = [
  { metric: 'hrv_rmssd_ms', unit: 'ms', mean: 54, lo: 50, hi: 58, nights: 30, forming: false },
  { metric: 'skin_temp_delta_c', unit: '°C', mean: 0.1, lo: 0, hi: 0.2, nights: 30, forming: false },
  { metric: 'spo2_avg_pct', unit: '%', mean: 97, lo: 96, hi: 98, nights: 30, forming: false },
];

function source(opts: { days: ResolvedDay[]; series?: Partial<Record<SeriesMetric, SeriesPoint[]>>; baselines?: SignalBaseline[]; person?: Partial<SignalsPerson> }): SignalsSource {
  return {
    subscribe: () => () => {},
    revision: () => 0,
    days: (from, to) => opts.days.filter((d) => d.localDate >= from && d.localDate <= to),
    series: async (metric, fromMs, toMs) => (opts.series?.[metric] ?? []).filter((p) => p.t >= fromMs && p.t <= toMs),
    baselines: async () => opts.baselines ?? BASELINES,
    firstDate: () => null,
    datesWithData: () => [],
    person: () => ({ goals: { steps: 8000, activeMin: 30 }, vendorScores: false, tempUnit: 'C', ...opts.person }),
    sourceInfo: () => ({ labels: [], lastReadAt: null }),
  };
}

function setup(src: SignalsSource, scenario: RingScenario | null = 'connected', ringPatch: Partial<RingStatus> = {}) {
  const fake = createFakeRingService(scenario ?? 'none', { now: NOW });
  const ring = scenario ? { ...fake.rings()[0]!, ...ringPatch } : null;
  const wrap = (children: ReactNode) => (
    <MemoryRouter>
      <LivingClockContext.Provider value={clock}>
        <RingServiceProvider service={fake} platform={scenarioPlatform(scenario ?? 'none')} sharing={createFakeSharing()}>
          <SignalsSourceProvider source={src}>{children}</SignalsSourceProvider>
        </RingServiceProvider>
      </LivingClockContext.Provider>
    </MemoryRouter>
  );
  return render(wrap(<TodayReadings ring={ring} />));
}

const rowEl = (id: string) => document.querySelector<HTMLAnchorElement>(`a[data-row="${id}"]`);
const readout = (id: string) => norm(rowEl(id)?.querySelector('.rs-row__readout')?.textContent);
const secondary = (id: string) => norm(rowEl(id)?.querySelector('.rs-row__sub')?.textContent);

const FULL = [day('2026-10-03'), day(TODAY, daily(), night())];

describe('Today from your ring', () => {
  it('shows every row with its readout and secondary line from the resolved day, each opening its tab', async () => {
    setup(source({ days: FULL }));
    expect(screen.getByRole('heading', { name: 'Today from your ring' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All body signals ›' }).getAttribute('href')).toBe('/signals');
    await waitFor(() => expect(readout('hrv')).toBe('−6 ms from your normal'));
    expect(readout('sleep')).toBe('7 h 12 min asleep');
    expect(secondary('sleep')).toBe('in bed 23:40 – 07:05 · 41 min unknown');
    expect(readout('heart')).toBe('resting 58 bpm');
    // live from the ring while connected and visible (the fake reports 72 bpm), stamped with the page clock
    expect(secondary('heart')).toBe('now 72 bpm · 13:41');
    expect(secondary('hrv')).toBe('48 ms last night · best for trends');
    // blood oxygen is tier C: change from the normal, no absolute percentage in the row
    expect(readout('spo2')).toBe('−1 % from your normal at night');
    expect(secondary('spo2')).toBe('last night · best for trends');
    expect(rowEl('spo2')!.textContent).not.toMatch(/9\d\s?%/);
    expect(readout('skin_temp')).toBe('+0.3 °C from your normal');
    expect(secondary('skin_temp')).toBe('last night');
    expect(secondary('activity')).toBe('6 420 steps · 34 active min · 280 kcal');
    expect(rowEl('sleep')!.getAttribute('href')).toBe('/signals');
    expect(rowEl('heart')!.getAttribute('href')).toBe('/signals?tab=heart');
    expect(rowEl('hrv')!.getAttribute('href')).toBe('/signals?tab=heart');
    expect(rowEl('activity')!.getAttribute('href')).toBe('/signals?tab=activity');
    expect([...document.querySelectorAll('a[data-row]')].map((a) => a.getAttribute('data-row'))).toEqual(['sleep', 'heart', 'hrv', 'spo2', 'skin_temp', 'activity']);
  });

  it('keeps a missing row with "no data yet today"; "reading…" while connected and not read yet today', async () => {
    const src = source({ days: [day(TODAY, daily({ hrv: undefined, spo2_avg_pct: undefined }), night())] });
    const { unmount } = setup(src, 'idle');
    await waitFor(() => expect(readout('hrv')).toBe('no data yet today'));
    expect(rowEl('hrv')!.querySelector('.rs-row__readout')!.getAttribute('data-missing')).toBe('true');
    expect(readout('spo2')).toBe('no data yet today');
    unmount();
    setup(src, 'connected', { lastSyncAt: iso('2026-10-03', '22:00') });
    await waitFor(() => expect(readout('hrv')).toBe('reading…'));
  });

  it('with no ring and nothing read from anywhere, nothing says "from your ring"; read data brings the rows back', async () => {
    const { unmount } = setup(source({ days: [day(TODAY)] }), null);
    await Promise.resolve();
    expect(screen.queryByRole('heading', { name: 'Today from your ring' })).toBeNull();
    unmount();
    // data that came from an import or another device: no ring here, but the rows show
    setup(source({ days: FULL }), null);
    await waitFor(() => expect(readout('sleep')).toBe('7 h 12 min asleep'));
    expect(screen.getByRole('heading', { name: 'Today from your ring' })).toBeTruthy();
    expect(readout('hrv')).toBe('−6 ms from your normal');
  });

  it('a known ring with nothing read yet still shows its rows as "no data yet today"', async () => {
    setup(source({ days: [day(TODAY)] }), 'idle');
    await waitFor(() => expect(readout('sleep')).toBe('no data yet today'));
    expect(screen.getByRole('heading', { name: 'Today from your ring' })).toBeTruthy();
  });

  it('says nothing about unknown sleep when there is none', async () => {
    setup(source({ days: [day(TODAY, daily(), night(false))] }));
    await waitFor(() => expect(secondary('sleep')).toBe('in bed 23:40 – 07:05'));
  });

  it('adds the age when the newest sample is over 3 h old (no live heart rate when not connected)', async () => {
    const t = local(TODAY, '09:41').getTime();
    setup(source({ days: FULL, series: { hr: [{ t: t - 60_000, v: 70 }, { t, v: 72 }], steps: [{ t: local(TODAY, '09:00').getTime(), v: 120 }] } }), 'idle');
    await waitFor(() => expect(secondary('heart')).toBe('last reading 72 bpm · 09:41 · 4 h ago'));
    await waitFor(() => expect(secondary('activity')).toBe('6 420 steps · 34 active min · 280 kcal · 4 h ago'));
  });

  it('shows the ring’s own scores only when vendor scores are on, always last', async () => {
    const { unmount } = setup(source({ days: FULL }));
    await waitFor(() => expect(rowEl('activity')).toBeTruthy());
    expect(rowEl('vendor')).toBeNull();
    unmount();
    setup(source({ days: FULL, person: { vendorScores: true } }));
    await waitFor(() => expect(readout('vendor')).toBe('sleep score 82 · stress 34'));
    expect(secondary('vendor')).toBe('(their estimate)');
    const ids = [...document.querySelectorAll('a[data-row]')].map((a) => a.getAttribute('data-row'));
    expect(ids[ids.length - 1]).toBe('vendor');
  });

  it('shows only the signals the ring measures', async () => {
    setup(source({ days: FULL }), 'connected', { caps: { measures: ['sleep', 'hr', 'activity'] } });
    await waitFor(() => expect(rowEl('sleep')).toBeTruthy());
    expect([...document.querySelectorAll('a[data-row]')].map((a) => a.getAttribute('data-row'))).toEqual(['sleep', 'heart', 'activity']);
  });

  it('never shows a forbidden word', async () => {
    setup(source({ days: FULL, person: { vendorScores: true } }));
    await waitFor(() => expect(readout('vendor')).not.toBe(''));
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/password|passcode|credential|\bPIN\b|MQTT|\blease\b|GATT|handshake|\bbond\b/i);
  });
});

describe('todayModel', () => {
  const base: TodayInput = {
    today: TODAY, now: NOW, days: FULL, baselines: BASELINES, person: { goals: {}, vendorScores: false, tempUnit: 'C' },
    live: null, lastHr: null, stepsNewestAt: null, reading: false,
  };
  const row = (input: TodayInput, id: string) => todayRows(input).find((r) => r.id === id)!;

  it('formats durations and ages', () => {
    expect(norm(fmtDuration(432))).toBe('7 h 12 min');
    expect(norm(fmtDuration(45))).toBe('45 min');
    expect(norm(fmtDuration(480))).toBe('8 h');
    expect(ageText(NOW, NOW - 2 * 3_600_000)).toBeNull();
    expect(ageText(NOW, NOW - 4 * 3_600_000)).toBe('4 h ago');
    expect(ageText(NOW, NOW - 30 * 3_600_000)).toBe('yesterday');
    expect(ageText(NOW, NOW - 3 * 86_400_000)).toBe('3 days ago');
  });

  it('heart-rate variability while the normal forms: the value first, the nights so far', () => {
    const r = row({ ...base, baselines: [{ ...BASELINES[0]!, forming: true, nights: 9 }] }, 'hrv');
    expect(norm(r.readout)).toBe('48 ms last night');
    expect(r.secondary).toBe('building your normal: 9 of 14 nights · best for trends');
  });

  it('blood oxygen while the normal forms: the night’s average, the nights so far; no tier words', () => {
    const r = row({ ...base, baselines: [{ ...BASELINES[2]!, forming: true, nights: 9 }] }, 'spo2');
    expect(norm(r.readout)).toBe('96 % at night');
    expect(r.secondary).toBe('building your normal: 9 of 14 nights · best for trends');
    const none = row({ ...base, baselines: [] }, 'spo2');
    expect(norm(none.readout)).toBe('96 % at night');
    expect(none.secondary).toBe('best for trends');
    const formed = row(base, 'spo2');
    expect(norm(formed.readout)).toBe('−1 % from your normal at night');
    expect(`${formed.readout} ${formed.secondary}`).not.toMatch(/tier/i);
  });

  it('uses the reference night when last night is missing, with its age', () => {
    const older = { ...night(), time: { ...night().time, local_date: '2026-10-03', start: iso('2026-10-02', '23:40'), end: iso('2026-10-03', '07:05') } };
    const r = row({ ...base, days: [day('2026-10-03', undefined, older), day(TODAY, daily())] }, 'sleep');
    expect(norm(r.readout)).toBe('7 h 12 min asleep');
    expect(norm(r.secondary)).toMatch(/· yesterday$/);
  });

  it('missing activity keeps the row, no meters; a zero is a value, not missing', () => {
    expect(row({ ...base, days: [day(TODAY, daily({ steps: undefined, active_min: undefined, active_kcal: undefined }))] }, 'activity').missing).toBe('no data yet today');
    const zero = row({ ...base, days: [day(TODAY, daily({ steps: 0, active_min: undefined, active_kcal: undefined }))] }, 'activity');
    expect(zero.missing).toBeNull();
    expect(zero.meters?.[0]?.value).toBe(0);
    expect(zero.meters?.[1]?.value).toBeNull();
  });

  it('heart without a resting value but with a reading says the resting value is not read yet', () => {
    const r = row({ ...base, days: [day(TODAY, daily({ resting_hr_bpm: undefined }))], live: { bpm: 70, at: NOW } }, 'heart');
    expect(r.missing).toBe('resting not read yet');
    expect(norm(r.secondary)).toMatch(/^now 70 bpm · \d\d:\d\d$/);
  });

  it('skin temperature in Fahrenheit converts the change', () => {
    const r = row({ ...base, person: { ...base.person, tempUnit: 'F' } }, 'skin_temp');
    expect(norm(r.readout)).toBe('+0.5 °F from your normal');
  });
});
