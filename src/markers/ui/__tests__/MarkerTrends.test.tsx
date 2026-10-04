import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { evaluationOf, ldlDoc } from './fixtures';

const state = vi.hoisted(() => ({ doc: null as unknown, evaluation: null as unknown }));
vi.mock('../useMarkers', () => ({
  markersToday: () => '2026-10-02',
  useMarkerDateStyle: () => 'day-month',
  useMarkerEvaluation: () => ({ doc: state.doc, evaluation: state.evaluation }),
}));

const { MarkerTrendsSection, markerSeriesView, markerSummary } = await import('../MarkerTrends');

const PLAN = {
  startDate: '2026-09-01',
  version: { forecast: { fromDay: 0, asPrescribed: { ldl: { p10: [4.6, 4.4, 4.2], p50: [4.8, 4.6, 4.4], p90: [5.0, 4.8, 4.6] } } } },
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
    expect(markerSummary(v, 'day-month')).toMatch(/^LDL cholesterol: 2 readings, latest 192 mg\/dL on 14 Sep 2026; likely range from the plan .* retest due 14 Dec 2026\.$/);
  });

  it('the spoken summary reads the last finite point of the band, never "NaN"', () => {
    const v = markerSeriesView('ldl', ldlDoc().readings, PLAN, '2026-10-02', null)!;
    const band = { ...v.band!, lo: [...v.band!.lo, Number.NaN], mid: [...v.band!.mid, Number.NaN], hi: [...v.band!.hi, Number.NaN] };
    expect(markerSummary({ ...v, band }, 'day-month')).not.toContain('NaN');
    expect(markerSummary({ ...v, band }, 'day-month')).toBe(markerSummary(v, 'day-month'));
    const empty = { ...v, band: { ...band, lo: [Number.NaN], mid: [Number.NaN], hi: [Number.NaN] } };
    expect(markerSummary(empty, 'day-month')).not.toMatch(/NaN|likely range/);
  });

  it('renders a chart per marker with points, the band, the retest line and the re-enter link', () => {
    state.doc = ldlDoc();
    state.evaluation = evaluationOf([], { retests: [{ markerId: 'ldl', due: '2026-12-14', rule: 'W-L-LDL-R' }] });
    const { container } = render(
      <MemoryRouter>
        <MarkerTrendsSection plan={PLAN} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'LDL cholesterol' })).toBeTruthy();
    // the reading before the plan start is in the table but not drawn left of day 0
    expect(screen.getAllByTestId('marker-point')).toHaveLength(1);
    expect(container.querySelector('.lm-marker-trend__band')).not.toBeNull();
    expect(screen.getByTestId('retest-line')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/retest due 14 Dec 2026/);
    expect(screen.getByRole('link', { name: 'Re-enter values' }).getAttribute('href')).toBe('/onboarding/markers');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('without a projection for the marker, readings only and says so; empty state invites entry', () => {
    state.doc = ldlDoc();
    state.evaluation = evaluationOf([]);
    const { unmount } = render(
      <MemoryRouter>
        <MarkerTrendsSection plan={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No projection for this marker/)).toBeTruthy();
    expect(screen.getAllByTestId('marker-point')).toHaveLength(2);
    unmount();
    state.doc = { _schema: 1, readings: [], displayOnly: [], context: {}, chapter: null };
    render(
      <MemoryRouter>
        <MarkerTrendsSection plan={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/No blood results yet/)).toBeTruthy();
  });
});
