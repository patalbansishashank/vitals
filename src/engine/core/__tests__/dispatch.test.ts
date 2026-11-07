// @vitest-environment node
import { runEngine } from '../loop';
import { compileSchedule } from '../compileSchedule';
import { resolveProfile } from '../resolveProfile';
import { hasDefaultHourOrder, MODULES } from '../moduleRegistry';
import type { RunOptions, SimulationResult } from '../../types';
import type { AnyEngineModule } from '../../types/module';
import { MAN, repeatSchedule } from './fixtures';

function deterministic(result: SimulationResult): SimulationResult {
  result.meta.runtimeMs = 0;
  return result;
}

describe('specialized hourly dispatch', () => {
  it('rejects missing, added, reordered and replaced providers', () => {
    expect(hasDefaultHourOrder(MODULES)).toBe(true);
    expect(hasDefaultHourOrder(MODULES.slice(1))).toBe(false);
    expect(hasDefaultHourOrder([...MODULES, MODULES[0]!])).toBe(false);
    const swapped = [...MODULES];
    [swapped[0], swapped[1]] = [swapped[1]!, swapped[0]!];
    expect(hasDefaultHourOrder(swapped)).toBe(false);
    expect(hasDefaultHourOrder([{ ...MODULES[0]! }, ...MODULES.slice(1)])).toBe(false);
  });

  it('falls back when a canonical provider hook is replaced', () => {
    const provider = MODULES[0]!;
    const original = provider.stepHour;
    const hook = vi.spyOn(provider, 'stepHour').mockImplementation(function (this: AnyEngineModule, ...args) {
      expect(this).toBe(provider);
      original.apply(provider, args);
    });
    try {
      expect(hasDefaultHourOrder(MODULES)).toBe(false);
      const profile = resolveProfile(MAN);
      runEngine(profile, compileSchedule(repeatSchedule(1, [0]), profile), { record: 'none' });
      expect(hook).toHaveBeenCalledTimes(15 * 24);
    } finally {
      hook.mockRestore();
    }
    expect(hasDefaultHourOrder(MODULES)).toBe(true);
  });

  it('matches generic dispatch exactly in every recording mode, including captured state', () => {
    const profile = resolveProfile(MAN);
    const schedule = repeatSchedule(21, [0, 1, 0, 1, 0, 1, 1]);
    const modes: RunOptions[] = [
      { record: 'none' },
      { record: 'daily', captureSnapshot: true, captureSnapshotAt: [0, 10] },
      { record: 'full', checks: true },
      { mode: 'planner', record: 'daily', series: ['fatMass', 'leanTissue', 'scaleWeight', 'bodyFatPct'], collectEvents: false },
    ];
    for (const options of modes) {
      const direct = runEngine(profile, compileSchedule(schedule, profile), options);
      const generic = runEngine(profile, compileSchedule(schedule, profile), options, [...MODULES]);
      expect(deterministic(direct)).toEqual(deterministic(generic));
    }
  });

  it('executes replacement provider hooks through the custom-list fallback', () => {
    const profile = resolveProfile(MAN);
    const schedule = repeatSchedule(2, [0, 1]);
    const original = MODULES[0]!;
    let calls = 0;
    const replacement: AnyEngineModule = {
      ...original,
      stepHour(...args) { calls++; original.stepHour(...args); },
    };
    const options: RunOptions = { record: 'full', captureSnapshot: true };
    const direct = runEngine(profile, compileSchedule(schedule, profile), options);
    const custom = runEngine(profile, compileSchedule(schedule, profile), options, [replacement, ...MODULES.slice(1)]);
    expect(calls).toBe((14 + 2) * 24);
    expect(deterministic(custom)).toEqual(deterministic(direct));
  });
});
