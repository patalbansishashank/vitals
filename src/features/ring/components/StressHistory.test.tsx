import { fireEvent, render, screen } from '@testing-library/react';
import { StressHistory } from './StressHistory';
import { clockText } from '@/components/viz/geometry';
const from = new Date('2026-11-02T00:00:00').getTime();
const hour = 3_600_000;
const bounds = { from, to: from + 24 * hour, now: from + 14 * hour };

describe('StressHistory', () => {
  it('keeps a sparse reading discrete and reports existing sample-support duration, leaving the rest unknown', () => {
    const { container } = render(<StressHistory {...bounds} points={[{ t: from + 6 * hour, v: 24 }]} />);
    expect(container.querySelectorAll('.rg-stress__dot')).toHaveLength(1);
    expect(container.querySelector('path')).toBeNull();
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('45 min estimated coverage; 13 h 15 uncovered time'),
    );
    expect(screen.getByText(`Latest · ${clockText(from + 6 * hour)}`)).toBeInTheDocument();
  });
  it('sorts readings, excludes invalid/outside/future samples, and supports keyboard inspection with exact local times', () => {
    const { container } = render(
      <StressHistory
        {...bounds}
        points={[
          { t: from + 12 * hour, v: 76 },
          { t: from + 6 * hour, v: 26 },
          { t: from + 16 * hour, v: 65 },
          { t: from - hour, v: 50 },
          { t: from + hour, v: NaN },
          { t: NaN, v: 50 },
        ]}
      />,
    );
    expect(container.querySelectorAll('.rg-stress__dot')).toHaveLength(2);
    const plot = screen.getByRole('img');
    expect(plot).toHaveAttribute('aria-label', expect.stringContaining('latest 76 ring index, High'));
    fireEvent.keyDown(plot, { key: 'Home' });
    expect(plot).toHaveAttribute('aria-label', expect.stringContaining('selected 26 ring index, Normal'));
    fireEvent.keyDown(plot, { key: 'ArrowRight' });
    expect(screen.getByText('76 · High')).toBeInTheDocument();
    fireEvent.keyDown(plot, { key: 'Escape' });
    expect(screen.getByText(`Latest · ${clockText(from + 12 * hour)}`)).toBeInTheDocument();
  });
  it('has an explicit empty state and no numeric or hidden data in quiet mode', () => {
    const { container, rerender } = render(<StressHistory {...bounds} points={[]} />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('0 min estimated coverage; 14 h uncovered time'),
    );
    expect(screen.getByText('No readings')).toBeInTheDocument();
    rerender(<StressHistory {...bounds} points={[{ t: from + hour, v: 89 }]} quiet />);
    expect(container.textContent).not.toMatch(/\d/);
    expect(container.querySelector('svg, [aria-label]')).toBeNull();
  });
});
