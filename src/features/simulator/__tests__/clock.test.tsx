import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ClockRing } from '../components/ClockRing';
import {
  arcPath,
  dailyFastHours,
  evenMeals,
  hourToAngle,
  isEven,
  keyStep,
  moveMeal,
  pointToHour,
  polar,
  setWindowEdge,
  shiftMeals,
  snapHour,
  windowOf,
  wrapDelta,
} from '../lib/clock';
import { formatClock } from '../lib/calendar';

describe('clock geometry', () => {
  it('00:00 at the top, clockwise, 15° per hour', () => {
    expect(hourToAngle(6)).toBeCloseTo(Math.PI / 2, 12);
    const [x0, y0] = polar(100, 100, 50, 0);
    expect(x0).toBeCloseTo(100, 9);
    expect(y0).toBeCloseTo(50, 9);
    const [x6, y6] = polar(100, 100, 50, 6);
    expect(x6).toBeCloseTo(150, 9);
    expect(y6).toBeCloseTo(100, 9);
    const [, y12] = polar(100, 100, 50, 12);
    expect(y12).toBeCloseTo(150, 9);
  });

  it('pointToHour inverts polar for every quarter hour', () => {
    for (let h = 0; h < 24; h += 0.25) {
      const [x, y] = polar(104, 104, 77, h);
      expect(pointToHour(104, 104, x, y)).toBeCloseTo(h, 9);
    }
  });

  it('arcs pick the large-arc flag past 12 h and draw full circles', () => {
    expect(arcPath(100, 100, 50, 8, 20)).toContain(' 0 0 1 ');
    expect(arcPath(100, 100, 50, 20, 12)).toContain(' 0 1 1 '); // 16 h across midnight
    expect(arcPath(100, 100, 50, 3, 3)).toBe('');
    expect(arcPath(100, 100, 50, 0, 24, true).match(/A/g)).toHaveLength(2);
  });

  it('wraps deltas across midnight and snaps to 15 / 5 min', () => {
    expect(wrapDelta(23, 1)).toBe(2);
    expect(wrapDelta(1, 23)).toBe(-2);
    expect(snapHour(12.13)).toBe(12.25);
    expect(snapHour(12.13, 5 / 60)).toBeCloseTo(12 + 10 / 60, 9);
    expect(formatClock(19.5)).toBe('19:30');
    expect(formatClock(24)).toBe('00:00');
  });

  it('window edges rescale inner meals; the window never collapses or leaves the day', () => {
    const t = [8, 14, 20];
    expect(windowOf(t)).toEqual({ start: 8, end: 20, length: 12 });
    expect(dailyFastHours(t)).toBe(12);
    expect(setWindowEdge(t, 'start', 12)).toEqual([12, 16, 20]);
    expect(setWindowEdge(t, 'end', 30)).toEqual([8, 16, 24]);
    const tight = setWindowEdge(t, 'start', 23);
    expect(tight[0]).toBeCloseTo(19, 9); // 2 × 0.5 h minimum gaps
    expect(moveMeal(t, 1, 22)).toEqual([8, 19.5, 20]); // a middle meal stays between its neighbours
    expect(shiftMeals(t, 10)).toEqual([12, 18, 24]);
    expect(shiftMeals(t, -20)).toEqual([0, 6, 12]);
    expect(isEven(evenMeals(3, 12, 8))).toBe(true);
    expect(isEven([12, 13, 20])).toBe(false);
  });

  it('keyboard steps: arrows 15 min, ⇧ 5 min, PgUp/PgDn 1 h', () => {
    expect(keyStep('ArrowRight', false)).toBe(0.25);
    expect(keyStep('ArrowLeft', true)).toBeCloseTo(-5 / 60, 9);
    expect(keyStep('PageUp', false)).toBe(1);
    expect(keyStep('Tab', false)).toBeNull();
  });
});

describe('<ClockRing> editor', () => {
  const meals = [
    { clockH: 12, kcal: 900 },
    { clockH: 16, kcal: 400 },
    { clockH: 20, kcal: 900 },
  ];

  it('exposes every thumb as an ARIA slider with a spoken time', () => {
    render(
      <ClockRing
        meals={meals}
        sessions={[{ kind: 'resistance', startH: 17.5, durationMin: 60, label: 'lift' }]}
        sleep={{ bedH: 23, wakeH: 7 }}
        onMealsChange={() => {}}
        onSessionMove={() => {}}
      />,
    );
    const start = screen.getByRole('slider', { name: 'window start' });
    expect(start).toHaveAttribute('aria-valuetext', 'window starts 12:00, 900 kcal');
    expect(screen.getByRole('slider', { name: 'window end' })).toHaveAttribute('aria-valuenow', '20');
    expect(screen.getByRole('slider', { name: 'meal 2 time' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'eating window' })).toHaveAttribute(
      'aria-valuetext',
      'window 12:00 to 20:00',
    );
    expect(screen.getByRole('slider', { name: 'lift start' })).toHaveAttribute(
      'aria-valuetext',
      'lift starts 17:30, 60 minutes',
    );
    expect(screen.getByText(/Eat 12:00 to 20:00, 3 meals/)).toBeInTheDocument();
    expect(screen.getByText('fast 16 h')).toBeInTheDocument();
    expect(screen.getByText('16:8')).toBeInTheDocument();
  });

  it('moves the window start with the keyboard and rescales the inner meal', () => {
    const onMealsChange = vi.fn();
    render(<ClockRing meals={meals} onMealsChange={onMealsChange} />);
    const start = screen.getByRole('slider', { name: 'window start' });
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(onMealsChange).toHaveBeenLastCalledWith([12.25, 16.125, 20]);
    fireEvent.keyDown(start, { key: 'ArrowLeft', shiftKey: true });
    const t = onMealsChange.mock.lastCall![0] as number[];
    expect(t[0]).toBeCloseTo(12 - 5 / 60, 9);
    fireEvent.keyDown(start, { key: 'PageDown' });
    expect(onMealsChange).toHaveBeenLastCalledWith([11, 15.5, 20]);
  });

  it('moves the whole window (length preserved) and sessions from the keyboard', () => {
    const onMealsChange = vi.fn();
    const onSessionMove = vi.fn();
    render(
      <ClockRing
        meals={meals}
        sessions={[{ kind: 'cardio', startH: 7, durationMin: 45, label: 'walk' }]}
        onMealsChange={onMealsChange}
        onSessionMove={onSessionMove}
      />,
    );
    fireEvent.keyDown(screen.getByRole('slider', { name: 'eating window' }), { key: 'PageUp' });
    expect(onMealsChange).toHaveBeenLastCalledWith([13, 17, 21]);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'walk start' }), { key: 'ArrowLeft' });
    expect(onSessionMove).toHaveBeenLastCalledWith(0, 6.75);
  });

  it('a water-only day shows the whole dial fasted and no meal thumbs', () => {
    render(<ClockRing meals={[]} fast={{ hours: 36, caption: 'ends Mon 08:00' }} />);
    expect(screen.queryByRole('slider', { name: 'window start' })).toBeNull();
    expect(screen.getByText('fast 36 h')).toBeInTheDocument();
    expect(screen.getByText('ends Mon 08:00')).toBeInTheDocument();
  });
});
