import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useSettingsStore } from '@/state/settingsStore';
import type { WeeklyModelReview } from '@/living/weeklyModel';
import { WeeklyModelSummary } from '../components/WeeklyModelSummary';

const model: WeeklyModelReview = {
  from: '2026-11-09',
  to: '2026-11-15',
  days: 7,
  decision: 'provisional',
  reason: 'needsEvidence',
  targetKcal: 1500,
  targetRangeKcal: [1500, 1500],
  expenditureKcal: 2600,
  deficitKcal: 1100,
  fatChangeKg: -0.6,
  muscleChangeKg: -0.01,
  muscleBudget: {
    maxLossPct: 5,
    baselineKg: 29,
    baselineDate: '2026-11-09',
    floorKg: 27.55,
    worstLossPct: 1,
    lowerScenarioLossPct: 3.5,
    status: 'withinBudget',
    basis: 'modelScenario',
  },
  evidence: {
    weighIns: 3,
    weighInsNeeded: 10,
    foodDays7: 2,
    foodDaysPrevious7: 0,
    foodDaysNeeded: 4,
    enoughInputs: false,
  },
  basis: 'adoptedPlanScenario',
};
afterEach(() => act(() => useSettingsStore.getState().set({ energyUnit: 'kcal', units: 'metric' })));

describe('weekly model summary', () => {
  it('shows the calorie target as provisional, with the evidence and whole-plan scenario budget', () => {
    render(<WeeklyModelSummary model={model} />);
    expect(screen.getByText('Target awaiting calibration')).toBeInTheDocument();
    expect(screen.getByText('1,500 kcal')).toBeInTheDocument();
    expect(screen.getByText(/complete food days 2\/7 this week, 0\/7 last week/)).toBeInTheDocument();
    expect(
      screen.getByText(/5\.0% whole-plan muscle-loss budget · 3.5% loss in the lower scenario/),
    ).toBeInTheDocument();
  });

  it('honors energy and mass units, including a variable daily prescription', () => {
    act(() => useSettingsStore.getState().set({ energyUnit: 'kJ', units: 'imperial' }));
    const { container } = render(<WeeklyModelSummary model={{ ...model, targetRangeKcal: [1500, 1800] }} />);
    expect(container.textContent).not.toMatch(/kcal| kg/);
    expect(screen.getByText('−1.3 lb')).toBeInTheDocument();
    expect(screen.getByText(/follow each day’s prescription/)).toHaveTextContent(/kJ/);
  });

  it('keeps the adopted target visible while a proposal waits for Apply', () => {
    render(<WeeklyModelSummary model={{ ...model, decision: 'changeReady', reason: 'pendingChange' }} />);
    expect(screen.getByText('Weekly change ready')).toBeInTheDocument();
    expect(screen.getByText(/stays in place until you apply the change below/)).toBeInTheDocument();
    expect(screen.getByText('1,500 kcal')).toBeInTheDocument();
  });

  it('shows the modeled magnitude behind a review and identifies the whole-plan baseline', () => {
    render(
      <WeeklyModelSummary
        model={{
          ...model,
          decision: 'review',
          muscleBudget: { ...model.muscleBudget!, status: 'overBudget', lowerScenarioLossPct: 5.8 },
        }}
      />,
    );
    expect(screen.getByText(/Review needed · 5.8% loss in the lower scenario/)).toBeInTheDocument();
    expect(screen.getByText(/starting modeled skeletal muscle across the whole plan/)).toBeInTheDocument();
  });

  it('hides quantities in quiet mode, and an incomplete forecast never reads as within budget', () => {
    const { container } = render(
      <WeeklyModelSummary
        quiet
        model={{ ...model, muscleBudget: { ...model.muscleBudget!, status: 'unavailable' } }}
      />,
    );
    expect(container.textContent).toContain('Forecast incomplete');
    expect(container.textContent).not.toMatch(/kcal|kg|%|3\.5|Within the modeled budget/);
    expect(screen.queryByRole('definition')).toBeNull();
  });
});
