import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { evaluationOf, ldlDoc } from './fixtures';

const state = vi.hoisted(() => ({ doc: null as unknown, evaluation: null as unknown }));
vi.mock('../useMarkers', () => ({
  markersToday: () => '2026-10-02',
  useMarkerDateStyle: () => 'day-month',
  useMarkerEvaluation: () => ({ doc: state.doc, evaluation: state.evaluation }),
}));

const { MarkerChart, MarkerTrendsSection, markerSeriesView, markerSummary, markerTwin } =
  await import('../MarkerTrends');

const PLAN = {
  startDate: '2026-09-01',
  version: {
    forecast: {
      fromDay: 0,
      asPrescribed: { ldl: { p10: [4.6, 4.4, 4.2], p50: [4.8, 4.6, 4.4], p90: [5.0, 4.8, 4.6] } },
    },
  },
};

describe('Progress › Blood markers', () => {
  it('builds readings against the projection band, in the unit of the latest reading', () => {
    const doc = ldlDoc();
    const v = markerSeriesView('ldl', doc.readings, PLAN, '2026-10-02', '2026-12-14')!;
    expect(v.unit).toBe('mg/dL');
    expect(v.points.map((p) => [p.day, Math.round(p.value)])).toEqual([
      [-92, 180],
      [13, 192],
    ]);
    expect(v.band!.mid[0]).toBeCloseTo(4.8 / 0.02586, 0);
    expect(v.retestDay).toBe(104);
    expect(markerSummary(v, 'day-month')).toMatch(
      /^LDL cholesterol: 2 readings, latest 192 mg\/dL on 14 Sep 2026; likely range from the plan .* retest due 14 Dec 2026\.$/,
    );
  });

  it('the spoken summary reads the last finite point of the band, never "NaN"', () => {
    const v = markerSeriesView('ldl', ldlDoc().readings, PLAN, '2026-10-02', null)!;
    const band = {
      ...v.band!,
      lo: [...v.band!.lo, Number.NaN],
      mid: [...v.band!.mid, Number.NaN],
      hi: [...v.band!.hi, Number.NaN],
    };
    expect(markerSummary({ ...v, band }, 'day-month')).not.toContain('NaN');
    expect(markerSummary({ ...v, band }, 'day-month')).toBe(markerSummary(v, 'day-month'));
    const empty = { ...v, band: { ...band, lo: [Number.NaN], mid: [Number.NaN], hi: [Number.NaN] } };
    expect(markerSummary(empty, 'day-month')).not.toMatch(/NaN|likely range/);
  });

  it('renders compact sparkline rows and keeps the readings twin in the information panel', () => {
    state.doc = ldlDoc();
    state.evaluation = evaluationOf([], {
      retests: [{ markerId: 'ldl', due: '2026-12-14', rule: 'W-L-LDL-R' }],
    });
    const { container } = render(
      <MemoryRouter>
        <MarkerTrendsSection plan={PLAN} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'LDL cholesterol' })).toBeTruthy();
    // Earlier readings remain visible in the history sparkline as well as its twin.
    expect(screen.getAllByTestId('marker-point')).toHaveLength(2);
    expect(container.querySelector('.lm-marker-trend__band')).not.toBeNull();
    expect(screen.getByTestId('retest-line')).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /LDL cholesterol: 2 readings/ }).getAttribute('aria-label'),
    ).toMatch(/retest due 14 Dec 2026/);
    expect(screen.getByRole('link', { name: 'Update results' }).getAttribute('href')).toBe(
      '/onboarding/markers',
    );
    expect(screen.queryByRole('link', { name: 'Re-enter values' })).toBeNull();
    expect(container.querySelector('header a')).toBeNull();
    expect(container.querySelector('footer a')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: 'LDL cholesterol' }), { key: 't' });
    const panel = screen.getByRole('dialog', { name: 'LDL cholesterol' });
    expect(within(panel).getByRole('table')).toBeTruthy();
    expect(within(panel).getByText('180')).toBeTruthy();
    expect(within(panel).getByText('192')).toBeTruthy();
    expect(within(panel).getByRole('link', { name: 'About LDL cholesterol' }).getAttribute('href')).toBe(
      '/evidence/28-lipids-ldl',
    );
  });

  it('moves absent-projection explanation into the row panel and previews missing results', () => {
    state.doc = ldlDoc();
    state.evaluation = evaluationOf([]);
    const { unmount } = render(
      <MemoryRouter>
        <MarkerTrendsSection plan={null} />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/No projection for this marker/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'LDL cholesterol' }));
    expect(
      within(screen.getByRole('dialog', { name: 'LDL cholesterol' })).getAllByText(
        /No projection for this marker/,
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByTestId('marker-point')).toHaveLength(2);
    unmount();
    state.doc = { _schema: 1, readings: [], displayOnly: [], context: {}, chapter: null };
    render(
      <MemoryRouter>
        <MarkerTrendsSection plan={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText('No results yet')).toBeTruthy();
    expect(screen.getAllByText('No result')).toHaveLength(3);
    expect(screen.getByText('HDL cholesterol')).toBeTruthy();
    expect(screen.getByText('triglycerides')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add results' }).getAttribute('href')).toBe(
      '/onboarding/markers',
    );
  });

  it('a scenario projection is labelled as one, never a likely range; a status that forbids reading it draws no band (C6, D7-07)', () => {
    const scenario = {
      ...PLAN,
      version: {
        forecast: {
          ...PLAN.version.forecast,
          outputStatus: {
            ldl: { status: 'scenario' as const, reasonCode: 'ketogenicLipidResponseUncertain', fromDay: 8 },
          },
        },
      },
    };
    const v = markerSeriesView('ldl', ldlDoc().readings, scenario, '2026-10-02', null)!;
    expect(v.band).not.toBeNull();
    expect(v.projectionStatus).toBe('Scenario');
    expect(markerSummary(v, 'day-month')).toMatch(/scenario range from the plan/);
    expect(markerSummary(v, 'day-month')).not.toMatch(/likely range/);
    const unsupported = {
      ...PLAN,
      version: {
        forecast: {
          ...PLAN.version.forecast,
          outputStatus: { ldl: { status: 'outOfDomain' as const, fromDay: 1 } },
        },
      },
    };
    const u = markerSeriesView('ldl', ldlDoc().readings, unsupported, '2026-10-02', null)!;
    expect(u.band).toBeNull();
    expect(u.projectionStatus).toBe('Unsupported');
    expect(markerSummary(u, 'day-month')).toMatch(/Projection: Unsupported/);
    // the readings themselves are untouched
    expect(u.points.map((p) => Math.round(p.value))).toEqual([180, 192]);
    state.doc = ldlDoc();
    state.evaluation = evaluationOf([]);
    const { container } = render(
      <MemoryRouter>
        <MarkerTrendsSection plan={scenario} />
      </MemoryRouter>,
    );
    expect(container.querySelector('.lm-marker-trend__band')).not.toBeNull();
    expect(screen.getByText('Projection: Scenario')).toBeTruthy();
    expect(screen.queryByText(/No projection for this marker/)).toBeNull();
  });

  it('keeps readings out of quiet rows, summaries and panels until Show numbers, then forgets the reveal after a mode change', () => {
    state.doc = ldlDoc();
    state.evaluation = evaluationOf([]);
    const { rerender } = render(
      <MemoryRouter>
        <MarkerTrendsSection plan={PLAN} quiet />
      </MemoryRouter>,
    );
    expect(screen.queryByText('192')).toBeNull();
    const spark = screen.getByRole('img');
    expect(spark.getAttribute('aria-label')).not.toMatch(/192|180|mg\/dL|2 readings/);
    fireEvent.click(screen.getByRole('button', { name: 'LDL cholesterol' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: /CSV/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show numbers' }));
    expect(screen.getByText('192')).toBeTruthy();
    rerender(
      <MemoryRouter>
        <MarkerTrendsSection plan={PLAN} quiet={false} />
      </MemoryRouter>,
    );
    rerender(
      <MemoryRouter>
        <MarkerTrendsSection plan={PLAN} quiet />
      </MemoryRouter>,
    );
    expect(screen.queryByText('192')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show numbers' })).toBeTruthy();
  });

  it('the card T key opens all twins, including projection ranges from the sparkline model', () => {
    state.doc = ldlDoc();
    state.evaluation = evaluationOf([]);
    const { container } = render(
      <MemoryRouter>
        <MarkerTrendsSection plan={PLAN} quiet={false} />
      </MemoryRouter>,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'About Blood markers' }), { key: 'T' });
    const panel = screen.getByRole('dialog', { name: 'Blood markers' });
    expect(within(panel).getByRole('table')).toBeTruthy();
    expect(container.querySelector('details')).toBeNull();
    const data = markerTwin(
      markerSeriesView('ldl', ldlDoc().readings, PLAN, '2026-10-02', null)!,
      'day-month',
    );
    expect(data.rows).toHaveLength(5);
    expect(data.rows[2]![4]).toBe('Plan projection');
    expect(data.rows[2]![2]).not.toBe('—');
  });

  it('renders the same final marks with motion unavailable and animation off', () => {
    const v = markerSeriesView('ldl', ldlDoc().readings, PLAN, '2026-10-02', null)!;
    const { container, rerender } = render(<MarkerChart v={v} style="day-month" quiet={false} />);
    const marks = () =>
      [...container.querySelectorAll('path, circle, line')].map((el) => [
        el.tagName,
        el.getAttribute('d'),
        el.getAttribute('cx'),
        el.getAttribute('cy'),
        el.getAttribute('x1'),
        el.getAttribute('y1'),
      ]);
    const final = marks();
    expect(container.querySelector('[data-reveal="pending"], .lmc-end__pulse')).toBeNull();
    rerender(<MarkerChart v={v} style="day-month" quiet={false} animate={false} />);
    expect(marks()).toEqual(final);
  });
});
