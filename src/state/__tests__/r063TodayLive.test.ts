/**
 * r063 S27/A29 and A16 through the state hook: today's model reads the live step snapshot (not only the throttled entry),
 * puts every logged session's window into its bouts, and its "so far" energy is recomputed on a bounded clock tick.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshState } from '@/commands/__tests__/harness';
import type { EnergyHour } from '@/living/sensors/energyDay';
import { loadTodayEnergySteps, TODAY_ENERGY_TICK_MS, useTodayEnergySteps, type TodayEnergyDeps } from '../livingActivity';
import { useProfileStore } from '../profileStore';
import { withSystemWrite } from '../scope';

const hours = (dayStart: number): EnergyHour[] => Array.from({ length: 24 }, (_, k) => ({ start: dayStart + k * 3_600_000, rmr: 60, tef: 10, neat: 25, stepsEnergy: 12, exerciseEnergy: 5, tdee: 100 }));

describe('r063: the today hook', () => {
  beforeEach(() => {
    freshState({ cleared: true });
    withSystemWrite(() => useProfileStore.setState({ sex: 'male', ageYears: 38, heightCm: 180, weightKg: 92, setup: 'done' }));
  });
  afterEach(() => vi.useRealTimers());

  it('S27: the live snapshot of today steps reaches the model', async () => {
    const { currentDay } = await import('@/commands');
    const now = Date.now();
    const today = currentDay(now);
    const model = await loadTodayEnergySteps({ now: () => now, runHours: async (_k, _p, _s, _i, d) => hours(d), liveSteps: () => ({ day: { date: today, steps: 4321 }, at: new Date(now).toISOString() }) });
    expect(model!.steps.fusedSoFar).toBe(4321);
  });

  it('S27/A29: "so far" is recomputed on the clock tick while visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let runs = 0;
    const deps: TodayEnergyDeps = {
      runHours: async (_k, _p, _s, _i, d) => {
        runs++;
        return hours(d);
      },
    };
    renderHook(() => useTodayEnergySteps(deps));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    const first = runs;
    expect(first).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TODAY_ENERGY_TICK_MS + 1_000);
    });
    expect(runs).toBeGreaterThan(first);
  });
});
