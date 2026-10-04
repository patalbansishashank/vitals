import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { DailyRecord, ResolvedDay, SleepRecord } from '@/biometrics/core/types';
import { LivingClockContext, fixedClock } from '@/features/living/clock';
import { SignalsSourceProvider, type SignalsSource } from '@/features/signals/data';
import type * as RingData from '@/features/signals/charts/ringData';
import { BodySignalsLink } from '../BodySignalsLink';
import { RingDetailExtras } from '../RingSections';

/* ------------------------------------------------------------------------------------------------ fixtures */

const prov = { channel: 'file:lumen_archive' as const, recording_method: 'automatic' as const, modality: 'sensed' as const, ingested_at: '2026-10-01T00:00:00Z' };
const iso = (min: number) => new Date(Date.parse('2026-10-03T17:30:00Z') + min * 60_000).toISOString();

function night(localDate: string, asleepMin: number): SleepRecord {
  return {
    kind: 'sleep', record_id: `s-${localDate}`, version: 1, is_main: true, asleep_s: asleepMin * 60,
    time: { start: iso(0), end: iso(450), tz_offset_s: 19800, local_date: localDate },
    provenance: prov, quality: { validation: 'vendor_proprietary', confidence: null, flags: [] },
    stages: [
      { stage: 'light', start: iso(10), end: iso(120) },
      { stage: 'deep', start: iso(120), end: iso(200) },
      { stage: 'rem', start: iso(200), end: iso(260) },
      { stage: 'unknown', start: iso(260), end: iso(300) },
      { stage: 'light', start: iso(300), end: iso(440) },
    ],
  } as SleepRecord;
}

function day(localDate: string, o: { night?: number; rest?: number; steps?: number } = {}): ResolvedDay {
  const daily = o.rest !== undefined || o.steps !== undefined ? ({ kind: 'daily', ...(o.rest !== undefined ? { resting_hr_bpm: o.rest } : {}), ...(o.steps !== undefined ? { steps: o.steps } : {}) } as DailyRecord) : undefined;
  return {
    localDate,
    ...(daily ? { daily } : {}),
    ...(o.night !== undefined ? { mainSleep: night(localDate, o.night) } : {}),
    sleeps: [], workouts: [], spots: [], sourceByMetric: {}, tierByMetric: {}, basisByMetric: {}, corrections: [],
  };
}

function source(days: ResolvedDay[]): SignalsSource {
  return {
    subscribe: () => () => {},
    revision: () => 1,
    days: (from, to) => days.filter((d) => d.localDate >= from && d.localDate <= to),
    series: async () => [],
    baselines: async () => [],
    firstDate: () => days[0]?.localDate ?? null,
    datesWithData: () => days.map((d) => d.localDate),
    person: () => ({ goals: {}, vendorScores: false, tempUnit: 'C' }),
    sourceInfo: () => ({ labels: [], lastReadAt: null }),
  };
}

// the score details read stored nights through ringData: serve one night with stages
vi.mock('@/features/signals/charts/ringData', async (orig) => {
  const real = await orig<typeof RingData>();
  return { ...real, useResolvedDays: () => [day('2026-10-04', { night: 412 })] };
});

function renderLink(days: ResolvedDay[]) {
  return render(
    <LivingClockContext.Provider value={fixedClock('2026-10-04T09:00:00')}>
      <SignalsSourceProvider source={source(days)}>
        <MemoryRouter>
          <BodySignalsLink />
        </MemoryRouter>
      </SignalsSourceProvider>
    </LivingClockContext.Provider>,
  );
}

const cellOf = (label: string | RegExp) => screen.getByText(label).closest('li')!;

/* ------------------------------------------------------------------------------------------------ tests */

describe('Progress › Body signals link card', () => {
  it('shows last night asleep, resting heart rate and steps today, and opens Body signals', () => {
    renderLink([day('2026-10-03', { night: 400, rest: 60, steps: 9100 }), day('2026-10-04', { night: 432, rest: 58, steps: 6420 })]);
    const face = document.getElementById('activity')!;
    expect(within(face).getByRole('heading', { level: 2, name: 'From your ring' })).toBeInTheDocument();
    expect(within(cellOf('last night asleep')).getByText(/^7\sh 12\smin$/)).toBeInTheDocument();
    expect(within(cellOf('resting heart rate')).getByText(/^58\sbpm$/)).toBeInTheDocument();
    expect(within(cellOf('steps today')).getByText(/^6\s?420$/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open body signals' })).toHaveAttribute('href', '/signals');
    expect(screen.getByRole('link', { name: 'Open body signals' })).toHaveTextContent('Open body signals ›');
  });

  it('missing is never zero: "no data", and "no data yet today" for steps', () => {
    renderLink([]);
    expect(within(cellOf('last night asleep')).getByText('no data')).toBeInTheDocument();
    expect(within(cellOf('resting heart rate')).getByText('no data')).toBeInTheDocument();
    expect(within(cellOf('steps today')).getByText('no data yet today')).toBeInTheDocument();
    expect(screen.queryByText(/^0/)).not.toBeInTheDocument();
  });

  it('an older night and an older resting value are named by their date', () => {
    renderLink([day('2026-10-02', { night: 380, rest: 61 }), day('2026-10-04', { steps: 0 })]);
    expect(within(cellOf('asleep, night to Fri 2 Oct')).getByText(/^6\sh 20\smin$/)).toBeInTheDocument();
    expect(within(cellOf('resting heart rate, Fri 2 Oct')).getByText(/^61\sbpm$/)).toBeInTheDocument();
    // a recorded 0 is a value, not missing
    expect(within(cellOf('steps today')).getByText('0')).toBeInTheDocument();
  });
});

describe('score details keep their ring views', () => {
  it('a sleep score detail still shows the night stages', () => {
    render(
      <LivingClockContext.Provider value={fixedClock('2026-10-04T09:00:00')}>
        <RingDetailExtras scoreId="sleep.tst" />
      </LivingClockContext.Provider>,
    );
    expect(screen.getByRole('heading', { name: 'Last night' })).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('deep', { exact: false })).toBeInTheDocument();
    expect(within(table).getByText('unknown', { exact: false })).toBeInTheDocument();
    expect(document.querySelectorAll('rect[data-stage="deep"]').length).toBeGreaterThan(0);
  });
});
