/**
 * r064 VIZ: the Ring charts draw smoothed views while the words, tables and CSVs stay raw. DayLine: a smoothed line and
 * band, no per-reading dots or spike marks, broken at a real gap, the highest and lowest RAW reading named in the
 * caption, the twin lists every raw reading. The sleep hypnogram (Sleep card and Sleep tab): four levels drawn from a
 * session's raw blocks; its table keeps Mixed and No stage.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Hypnogram, sessionStageSpans } from '../components/RingCharts';
import { ChartTwin, GlowLine, lineModel, lineTwin } from '@/components';
import { signalLine } from '../views/detailSeries';
import { hypnogramTwin } from '../twins';
import type { GaugeSleepSession } from '../types';

/** A day of minute readings 00:00–14:00 and 16:00–20:00 (a charging gap), noisy, with two spikes. */
function minuteDay() {
  const pts: Array<{ hour: number; value: number }> = [];
  for (let m = 0; m < 20 * 60; m++) {
    if (m >= 14 * 60 && m < 16 * 60) continue;
    const base = m < 7 * 60 ? 55 : 75;
    const v = m === 600 ? 119 : m === 200 ? 41 : base + ((m * 7) % 9) - 4;
    pts.push({ hour: m / 60, value: v });
  }
  return pts;
}

const asSeries = (points: ReturnType<typeof minuteDay>) =>
  signalLine(points.map((p) => ({ t: p.hour * 3_600_000, v: p.value })));

describe('Ring signal GlowLine (r071)', () => {
  it('draws one line and normal band per recorded run, with raw extremes in its accessible sentence', () => {
    const series = asSeries(minuteDay());
    const { container } = render(
      <GlowLine
        label="Heart rate on Tue"
        series={series}
        unit="bpm"
        from={0}
        to={24 * 3_600_000}
        band="iqr"
        yTicks={0}
        twin={false}
        animate={false}
      />,
    );
    expect(container.querySelectorAll('path.lmz-line__main')).toHaveLength(2);
    expect(container.querySelectorAll('path.lmz-line__band')).toHaveLength(2);
    expect(screen.getByRole('img').getAttribute('aria-label')).toMatch(/lowest 41, highest 119/);
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
  });

  it('never draws inside a charging gap and smooths isolated spikes', () => {
    const model = lineModel({ series: asSeries(minuteDay()), from: 0, to: 24 * 3_600_000, height: 180 }, 300);
    expect(model.runs).toHaveLength(2);
    expect(model.runs.flat().some((p) => p.t > 14 * 3_600_000 && p.t < 16 * 3_600_000)).toBe(false);
    expect(Math.max(...model.runs.flat().map((p) => p.v))).toBeLessThan(85);
    expect(Math.min(...model.runs.flat().map((p) => p.v))).toBeGreaterThan(48);
  });

  it('the info-panel twin keeps every raw reading and an explicit missing row', () => {
    const points = minuteDay();
    const twin = lineTwin({
      label: 'Heart rate on Tue',
      series: asSeries(points),
      unit: 'bpm',
      from: 0,
      to: 24 * 3_600_000,
      tz: 'UTC',
    });
    render(<ChartTwin data={twin} />);
    const region = screen.getByRole('region', { name: 'Heart rate on Tue table' });
    const rows = within(region).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(points.length + 1);
    expect(twin.rows.some((r) => r[1] === '119')).toBe(true);
    expect(twin.rows.some((r) => r[1] === '—')).toBe(true);
  });

  it('keeps a flat reading and a single point as real readings', () => {
    const flat = signalLine([
      { t: 0, v: 60 },
      { t: 60_000, v: 60 },
      { t: 120_000, v: 60 },
    ]);
    expect(lineTwin({ label: 'Flat signal', series: flat }).rows).toHaveLength(3);
    expect(lineModel({ series: [{ t: 0, v: 60 }], height: 160 }, 300).empty).toBe(false);
  });
});

describe('Sleep hypnogram from a Gauge session (r064)', () => {
  const iso = (m: number) => new Date(Date.parse('2026-10-27T23:00:00Z') + m * 60_000).toISOString();
  const blocks: GaugeSleepSession['blocks'] = (
    [
      ['awake', 0, 10],
      ['light', 10, 30],
      ['deep', 30, 31],
      ['light', 31, 33],
      ['deep', 33, 70],
      ['unknown', 70, 110],
      ['asleepUnspecified', 110, 112],
      ['rem', 112, 140],
    ] as const
  ).map(([stage, a, b]) => ({
    stage: stage as GaugeSleepSession['blocks'][number]['stage'],
    start: iso(a),
    end: iso(b),
    minutes: b - a,
  }));
  const session = { start: iso(0), end: iso(140), blocks } as unknown as GaugeSleepSession;

  it('maps unknown to no stage and asleep-without-a-stage to Mixed', () => {
    expect(sessionStageSpans(blocks).map((s) => s.state)).toEqual([0, 2, 3, 2, 3, null, 'mixed', 1]);
  });

  it("draws four levels, the long unknown as one gap; its table (in the card's (i) panel) keeps the raw blocks", () => {
    const { container } = render(<Hypnogram session={session} />);
    expect(container.querySelectorAll('[data-row]')).toHaveLength(4);
    expect(container.querySelectorAll('[data-mark="gap"]')).toHaveLength(1);
    const drawn = [...container.querySelectorAll('.lmv-hyp__bar')].map((b) => b.getAttribute('data-stage'));
    expect(drawn).toEqual(['awake', 'light', 'deep', 'rem']);
    // (r071) the Table key left the chart: the picture has none, and the panel's twin is this table
    expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
    const twin = hypnogramTwin({
      label: 'Sleep stages',
      from: Date.parse(session.start),
      to: Date.parse(session.end),
      segments: sessionStageSpans(blocks),
    });
    expect(twin.head).toEqual(['Stage', 'From', 'To', 'Length']);
    expect(twin.rows.map((r) => r[0])).toEqual([
      'Awake',
      'Light',
      'Deep',
      'Light',
      'Deep',
      'No stage',
      'Mixed',
      'REM',
    ]);
    expect(twin.title).toBe('Sleep stages table');
  });
});
