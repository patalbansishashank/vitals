import { render, screen } from '@testing-library/react';
import { StepsHistory, stepsRollingMean } from '../views/StepsHistoryCard';

it('a rolling mean needs seven observed days; a missing day stays unknown', () => {
  expect(stepsRollingMean([100, 100, 100, 100, 100, 100, 100])).toEqual([
    null,
    null,
    null,
    null,
    null,
    null,
    100,
  ]);
  expect(stepsRollingMean([100, 100, 100, null, 100, 100, 100, 100])).toEqual([
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ]);
  expect(stepsRollingMean([0, 0, 0, 0, 0, 0, 0]).at(-1)).toBe(0);
});

it('steps history averages recorded days, preserving a missing day and an observed zero', () => {
  render(
    <StepsHistory
      dates={['2026-10-28', '2026-10-29', '2026-10-30']}
      values={[1000, null, 0]}
      goal={9000}
      selected="2026-10-30"
    />,
  );
  expect(screen.getByRole('img', { name: 'Daily average 500 steps' })).toBeInTheDocument();
  expect(screen.getByText('Avg per day · 2 of 3 days')).toBeInTheDocument();
  expect(screen.getByText('Total 1,000 steps')).toBeInTheDocument();
});
