/**
 * A1-002 — Planner publishing builds its clinical safety with the same headless composer the lifecycle boundaries and the
 * re-plan request use (`withCurrentSafety`): a current marker lock (TG ≥ 500 mg/dL → fat ≤ 30 %E, carbohydrate ≥ 50 g/d)
 * reaches the published request with the Planner's own rule context and day; without goals nothing is published (the
 * boundaries build their own current safety — a goal is never needed for it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { dispatch, settleCommits } from '@/commands';
import { freshState } from '@/commands/__tests__/harness';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { markersToday } from '@/markers/ui/useMarkers';
import { EMPTY_RUN, pickPlannerValues, usePlannerStore } from '@/state/plannerStore';
import { useProfileStore } from '@/state/profileStore';
import { withSystemWrite } from '@/state/scope';
import { usePlannerModel } from '../model';
import { GOALS } from './fixtures';

vi.mock('../plannerClient', () => ({ estimateTargetsAsync: () => Promise.resolve([]) }));

const daysAgo = (n: number): string => {
  const d = new Date(`${markersToday()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

beforeEach(() => {
  freshState({ cleared: true });
  seedClearedSafety();
  withSystemWrite(() => useProfileStore.setState({ sex: 'male', ageYears: 38, heightCm: 180, weightKg: 92, setup: 'done' }));
  withSystemWrite(() => usePlannerStore.setState({ ...pickPlannerValues({ horizonDays: 28 }), goals: GOALS.map((g) => ({ ...g })), run: EMPTY_RUN }));
});
afterEach(() => withSystemWrite(() => usePlannerStore.setState({ run: EMPTY_RUN })));

describe('Planner publishing uses the shared current-safety composer (A1-002)', () => {
  it('a fresh TG 1000 mg/dL puts the marker fat cap (30 %E) and carbohydrate floor into the published request', async () => {
    expect((await dispatch('markers.set', { readings: [{ id: 'tg', value: 1000, unit: 'mg/dL', date: daysAgo(2) }] })).ok).toBe(true);
    await settleCommits();
    const { result } = renderHook(() => usePlannerModel());
    await waitFor(() => expect(result.current.request?.safety?.plannerLocks?.some((l) => l.id === 'fat-cap')).toBe(true));
    const locks = result.current.request!.safety!.plannerLocks!;
    expect(locks.find((l) => l.id === 'fat-cap')).toMatchObject({ value: 30, unit: '%E' });
    expect(locks.find((l) => l.id === 'carb-floor')).toMatchObject({ value: 50, unit: 'g/d' });
    // the marker's note travels with the request (shown before the ladder)
    expect(JSON.stringify(result.current.request!.markerWarnings ?? [])).toMatch(/30 % of energy/);
  });

  it('a benign marker adds no lock (planning stays available)', async () => {
    expect((await dispatch('markers.set', { readings: [{ id: 'tg', value: 90, unit: 'mg/dL', date: daysAgo(2) }] })).ok).toBe(true);
    await settleCommits();
    const { result } = renderHook(() => usePlannerModel());
    await waitFor(() => expect(result.current.request).not.toBeNull());
    expect(result.current.request!.safety?.plannerLocks?.some((l) => l.id === 'fat-cap') ?? false).toBe(false);
  });

  it('without goals nothing is published (the intentional no-goal publisher behaviour)', async () => {
    withSystemWrite(() => usePlannerStore.setState({ goals: [] }));
    const { result } = renderHook(() => usePlannerModel());
    expect(result.current.request).toBeNull();
  });
});
