import './setupDom';
import { describe, expect, it } from 'vitest';
import { changeText } from '../components/LaneRow';
import type { ChartSeries } from '../types';

function series(unit: string, values: number[], baseline?: number): ChartSeries {
  return {
    id: 'm',
    label: 'Metric',
    unit,
    category: 'hormones',
    direction: 'neutral',
    grade: 'B',
    format: { decimals: 1 },
    daily: { values: Float32Array.from(values) },
    baseline,
  } as ChartSeries;
}

describe('lane gutter change text', () => {
  it('shows the percent change for ordinary metrics', () => {
    expect(changeText(series('kg', [20, 18]), 18)).toMatch(/−10\.0\s%/);
  });
  it('is empty for series that already read as a change from start (QA: "−58.0 % vs start −58.0 % vs start")', () => {
    expect(changeText(series('% vs start', [0, -30, -58]), -58)).toBe('');
    expect(changeText(series('kcal/d', [0, -87], 0), -87)).toBe('');
  });
});
