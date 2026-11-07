/** C6: the table twin shows a status word where a status hides a value, and its range caption makes no likelihood claim. */
import '@/features/charts/test/setupDom';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DataTable } from './DataTable';
import type { ChartSeries, TimeBase } from '../types';

const time = { days: 3, startDate: '2026-10-05' } as unknown as TimeBase;
const series = [
  {
    id: 'ldl',
    label: 'LDL',
    unit: 'mmol/L',
    category: 'cardio',
    grade: 'B',
    kind: 'line',
    format: { decimals: 1 },
    daily: { values: new Float32Array([4.2, Number.NaN, Number.NaN]) },
  },
] as unknown as ChartSeries[];

describe('DataTable', () => {
  it('replaces a hidden value with the status word and never says "likely"', () => {
    const { container } = render(<DataTable time={time} series={series} x0={0} x1={3} res="daily" statusWords={{ ldl: 'Unsupported' }} />);
    expect(screen.getAllByText('Unsupported').length).toBeGreaterThan(0);
    expect(container.querySelector('caption')!.textContent).not.toMatch(/likely|80 %/);
  });
});
