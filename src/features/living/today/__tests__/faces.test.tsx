import { fireEvent, render, screen, within } from '@testing-library/react';
import { LivingActionsProvider, type LivingActions } from '../../data/actions';
import { MemoryRouter } from 'react-router';
import { SoFarFace, WeightFace, PlanlessWeightFace, weightLine } from '../components/Faces';
import { todayViewFixture } from './todayView.fixture';
import type { TrendLaneData } from '@/features/charts/living/types';

const lane: TrendLaneData = {
  startDate: '2026-09-11',
  days: 20,
  todayIndex: 19,
  unit: 'kg',
  decimals: 1,
  trend: Array.from({ length: 20 }, (_, i) => 85 - i / 10),
  trendSd: Array.from({ length: 20 }, () => 0.2),
  weighIns: [{ day: 19, value: 83.1, flagged: true }],
  realistic: { p10: Array.from({ length: 20 }, () => 82), p90: Array.from({ length: 20 }, () => 86) },
};
const wrap = (node: React.ReactNode) => render(<MemoryRouter>{node}</MemoryRouter>);

it('unknown intake stays unknown while confirmed zero is a real zero', () => {
  const v = todayViewFixture();
  v.logged.totals.energyKcal.value = 0;
  const { rerender } = render(
    <SoFarFace view={v} quiet={false} size="sm" title="Eaten so far" onArc={() => undefined} />,
  );
  expect(screen.getByRole('meter', { name: 'Eaten' })).not.toHaveAttribute('aria-valuenow');
  expect(screen.getByText('Nothing logged yet')).toBeInTheDocument();
  v.coverage = { energy: 'confirmedZero', protein: 'confirmedZero' } as typeof v.coverage;
  rerender(<SoFarFace view={v} quiet={false} size="sm" title="Eaten so far" onArc={() => undefined} />);
  expect(screen.getByRole('meter', { name: 'Eaten' })).toHaveAttribute('aria-valuenow', '0');
});

it('the intake explanation carries Remove from Today and preserves a partial protein lower bound', () => {
  const v = todayViewFixture();
  v.coverage = { energy: 'complete', protein: 'partial' } as typeof v.coverage;
  const remove = vi.fn();
  wrap(
    <SoFarFace
      view={v}
      quiet={false}
      size="sm"
      title="Eaten so far"
      onArc={() => undefined}
      onRemove={remove}
    />,
  );
  expect(screen.getByRole('meter', { name: 'Protein' })).toHaveAttribute(
    'aria-valuetext',
    expect.stringContaining('at least 33 g'),
  );
  fireEvent.click(screen.getByRole('button', { name: 'About Eaten so far' }));
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Eaten so far' })).getByRole('button', {
      name: 'Remove from Today: Eaten so far',
    }),
  );
  expect(remove).toHaveBeenCalledOnce();
});

it('a quiet weight card has no weight, range or goal date digits, including its info panel', () => {
  const { container } = wrap(<WeightFace view={todayViewFixture()} trend={lane} quiet compact isToday />);
  expect(container.textContent).not.toMatch(/\d/);
  expect(screen.getByRole('link', { name: 'Weight' })).toHaveAttribute('href', '/progress#trend');
  fireEvent.click(screen.getByRole('button', { name: 'About Weight' }));
  const dialog = screen.getByRole('dialog', { name: 'Weight' });
  expect(dialog.textContent).not.toMatch(/\d/);
  expect(within(dialog).queryByRole('button', { name: 'Table' })).toBeNull();
});

it('the compact weight chart keeps the last fourteen real dates, ranges and flagged weigh-ins', () => {
  const chart = weightLine(lane, false);
  expect(chart.series).toHaveLength(14);
  expect(chart.series[0]).toEqual({ t: new Date('2026-09-17T00:00:00').getTime(), v: 84.4 });
  expect(chart.band).toEqual({
    lo: Array.from({ length: 14 }, () => 82),
    hi: Array.from({ length: 14 }, () => 86),
  });
  expect(chart.marks?.[0]).toMatchObject({ hollow: true, v: 83.1 });
});

it('the planless weight empty state opens the weight logger', () => {
  wrap(
    <LivingActionsProvider value={{ logMeasurement: vi.fn() } as unknown as LivingActions}>
      <PlanlessWeightFace trend={null} quiet={false} date="2026-09-30" />
    </LivingActionsProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Log weight' }));
  expect(screen.getByRole('dialog', { name: /Weight/ })).toBeInTheDocument();
});

it('quiet intake keeps numbers out of the score disclosure and its chart titles', () => {
  const { container } = wrap(<SoFarFace view={todayViewFixture()} quiet size="sm" title="Eaten so far" />);
  fireEvent.click(screen.getByRole('button', { name: 'Plan score' }));
  expect(container.textContent).not.toMatch(/\d/);
});
