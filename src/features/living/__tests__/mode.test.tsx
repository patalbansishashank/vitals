import { act, render, renderHook, screen } from '@testing-library/react';
import { deriveAppMode, planDayOf, setActivePlanSource, useAppMode, useActivePlan } from '../mode';
import { inMemoryActivePlanSource, isLivePlan, resetActivePlan, useActivePlanStore, type ActivePlan, type ActivePlanSource } from '../activePlan';
import { fixturePlan } from '../data/fixtures';

afterEach(() => {
  setActivePlanSource(inMemoryActivePlanSource);
  resetActivePlan();
});

describe('deriveAppMode (SUITE_SPEC §6.1)', () => {
  it('is Living only while a plan is scheduled, active or paused and the planning override is off', () => {
    const table: Array<[ActivePlan['status'] | null, boolean, 'living' | 'planning']> = [
      [null, false, 'planning'],
      [null, true, 'planning'],
      ['scheduled', false, 'living'],
      ['active', false, 'living'],
      ['paused', false, 'living'],
      ['ended', false, 'planning'],
      ['scheduled', true, 'planning'],
      ['active', true, 'planning'],
      ['paused', true, 'planning'],
    ];
    for (const [status, override, mode] of table) expect(deriveAppMode(status ? { status } : null, override)).toBe(mode);
  });

  it('knows which statuses are live', () => {
    expect(isLivePlan({ status: 'active' })).toBe(true);
    expect(isLivePlan({ status: 'ended' })).toBe(false);
    expect(isLivePlan(null)).toBe(false);
  });

  it('reads day n of N from the plan span', () => {
    const p = fixturePlan('2026-10-01');
    expect(planDayOf(p, '2026-10-01')).toEqual({ day: 15, of: 84 });
    expect(planDayOf(p, p.startDate)).toEqual({ day: 1, of: 84 });
  });
});

describe('useAppMode', () => {
  it('follows the active-plan store: no plan → planning; start → living; override → planning with the plan kept; end → planning', () => {
    const { result } = renderHook(() => useAppMode());
    expect(result.current).toEqual({ mode: 'planning', plan: null, override: false });
    const plan = fixturePlan('2026-10-01');
    act(() => useActivePlanStore.getState().setPlan(plan));
    expect(result.current.mode).toBe('living');
    expect(result.current.plan?.name).toBe('Spring cut');
    act(() => useActivePlanStore.getState().setPlanningOverride(true));
    expect(result.current).toMatchObject({ mode: 'planning', override: true });
    expect(result.current.plan?.id).toBe(plan.id);
    act(() => useActivePlanStore.getState().setPlanningOverride(false));
    expect(result.current.mode).toBe('living');
    act(() => useActivePlanStore.getState().endPlan('2026-10-01', 'abandoned'));
    expect(result.current).toEqual({ mode: 'planning', plan: null, override: false });
    expect(useActivePlanStore.getState().ended[0]?.reason).toBe('abandoned');
  });

  it('ignores the override without a plan and clears it when a plan starts', () => {
    act(() => useActivePlanStore.getState().setPlanningOverride(true));
    expect(useActivePlanStore.getState().planningOverride).toBe(false);
    act(() => {
      useActivePlanStore.getState().setPlan(fixturePlan('2026-10-01'));
      useActivePlanStore.getState().setPlanningOverride(true);
      useActivePlanStore.getState().setPlan(fixturePlan('2026-10-01', { dayIndex: 0 }));
    });
    expect(useActivePlanStore.getState().planningOverride).toBe(false);
  });

  it('treats an ended plan from the source as no plan', () => {
    act(() => useActivePlanStore.getState().setPlan({ ...fixturePlan('2026-10-01'), status: 'ended' }));
    const { result } = renderHook(() => useActivePlan());
    expect(result.current).toBeNull();
  });

  it('reads through a swappable ActivePlanSource (the interface E5/E4 implement)', () => {
    let snap: ReturnType<ActivePlanSource['get']> = { plan: { ...fixturePlan('2026-10-01'), status: 'paused' }, planningOverride: false };
    const ls = new Set<() => void>();
    setActivePlanSource({ get: () => snap, subscribe: (l) => (ls.add(l), () => ls.delete(l)) });
    function Probe() {
      const m = useAppMode();
      return <p>{`${m.mode}:${m.plan?.status ?? 'none'}`}</p>;
    }
    render(<Probe />);
    expect(screen.getByText('living:paused')).toBeInTheDocument();
    act(() => {
      snap = { plan: snap.plan, planningOverride: true };
      ls.forEach((l) => l());
    });
    expect(screen.getByText('planning:paused')).toBeInTheDocument();
  });
});
