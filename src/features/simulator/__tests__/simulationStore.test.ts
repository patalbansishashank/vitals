import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PersonProfile, RunOptions, Schedule, SimulationResult } from '@/engine';
import { resetScheduleStore, useScheduleStore } from '@/state/scheduleStore';
import {
  computeBands,
  resetSimulationStore,
  runHash,
  useSimulation,
  useSimulationStore,
} from '@/state/simulationStore';
import {
  setSimulationClient,
  type DrawChunkSpec,
  type DrawSeries,
  type SimulationClient,
} from '@/workers/simulationClient';
import { seedClearedSafety } from '@/features/onboarding/testing';
import { MAN, schedule } from './fixtures';

/** A controllable fake worker: every call returns a promise the test resolves. */
function mockClient() {
  const calls: Array<{
    kind: 'nominal' | 'draws';
    spec?: DrawChunkSpec;
    resolve: (v: unknown) => void;
    reject: (e: unknown) => void;
  }> = [];
  let cancelled = 0;
  const client: SimulationClient = {
    runNominal: (_p: PersonProfile, _s: Schedule, _o?: RunOptions) =>
      new Promise((resolve, reject) =>
        calls.push({ kind: 'nominal', resolve: resolve as (v: unknown) => void, reject }),
      ),
    runDraws: (_p, _s, spec) =>
      new Promise((resolve, reject) =>
        calls.push({ kind: 'draws', spec, resolve: resolve as (v: unknown) => void, reject }),
      ),
    preview: async () => ({ fatMass: new Float32Array(1), ketosis: new Float32Array(1) }),
    cancel: () => {
      cancelled++;
    },
  };
  return { client, calls, cancelled: () => cancelled };
}

function fakeResult(n: number, base: number): SimulationResult {
  const fat = new Float32Array(n).map((_, d) => base - d * 0.1);
  return {
    meta: {
      engineVersion: 't',
      registryHash: 'h',
      nDays: n,
      startDate: '2026-10-05',
      startWeekday: 0,
      record: 'full',
      series: ['fatMass'],
      runtimeMs: 1,
      compileNotes: [],
    },
    initial: { fatMass: base },
    daily: { fatMass: fat },
    hourly: {},
    final: { fatMass: fat[n - 1] },
    safety: {} as SimulationResult['safety'],
    events: [{ type: 'fastStart', hour: 20, day: 0, value: 0 }],
    warnings: [
      {
        id: 'W-F04',
        severity: 'danger',
        startDay: 1,
        endDay: 3,
        peakValue: 80,
        message: 'Water fasts…',
        src: '17',
      },
    ],
  };
}

const draw = (n: number, offset: number): DrawSeries => ({
  fatMass: new Float32Array(n).map((_, d) => 20 - d * 0.1 + offset),
});
const flush = () => new Promise((r) => setTimeout(r, 0));

let mock: ReturnType<typeof mockClient>;
beforeEach(() => {
  localStorage.clear();
  resetScheduleStore('2026-09-30');
  resetSimulationStore();
  mock = mockClient();
  setSimulationClient(mock.client);
});
afterEach(() => setSimulationClient(null));

describe('computeBands', () => {
  it('P10/P50/P90 over nominal + draws, deterministic, ignoring NaN', () => {
    const nominal = { fatMass: new Float32Array([10, 10]) };
    const draws = [8, 9, 11, 12].map((v) => ({ fatMass: new Float32Array([v, Number.NaN]) }));
    const b = computeBands(nominal, draws, 4);
    expect(b.p50.fatMass![0]).toBeCloseTo(10, 6);
    expect(b.p10.fatMass![0]).toBeCloseTo(8.4, 6);
    expect(b.p90.fatMass![0]).toBeCloseTo(11.6, 6);
    expect(b.p50.fatMass![1]).toBe(10);
    expect(b.complete).toBe(true);
    expect(computeBands(nominal, draws, 4)).toEqual(b);
  });
});

describe('run orchestration', () => {
  it('shows the nominal run first, then streams bands chunk by chunk', async () => {
    const s = schedule(7);
    const run = useSimulationStore.getState().run('sc', MAN, s, { draws: 8 });
    await flush();
    let st = useSimulationStore.getState().runs.sc!;
    expect(st.status).toBe('running');
    expect(st.phase).toBe('nominal');
    expect(useSimulationStore.getState().lastRuns.sc!.hash).toBe(runHash(MAN, s));
    mock.calls[0]!.resolve(fakeResult(7, 20));
    await flush();
    st = useSimulationStore.getState().runs.sc!;
    expect(st.result?.daily.fatMass?.[0]).toBe(20);
    expect(st.phase).toBe('ensemble');
    expect(st.bands).toBeNull();
    expect(mock.calls[1]!.spec).toEqual({ seed: 1, total: 8, start: 0, count: 4 });
    mock.calls[1]!.resolve([draw(7, -1), draw(7, 1), draw(7, -2), draw(7, 2)]);
    await flush();
    st = useSimulationStore.getState().runs.sc!;
    expect(st.bands?.drawsDone).toBe(4);
    expect(st.bands?.complete).toBe(false);
    expect(st.progress).toBeCloseTo(5 / 9, 9);
    expect(mock.calls[2]!.spec).toMatchObject({ start: 4, count: 4 });
    mock.calls[2]!.resolve([draw(7, 0.5), draw(7, -0.5), draw(7, 3), draw(7, -3)]);
    await run;
    st = useSimulationStore.getState().runs.sc!;
    expect(st.status).toBe('done');
    expect(st.progress).toBe(1);
    expect(st.bands?.complete).toBe(true);
    expect(st.bands!.p10.fatMass![0]!).toBeLessThan(st.bands!.p90.fatMass![0]!);
  });

  it('cancel stops the run immediately and ignores late results', async () => {
    const run = useSimulationStore.getState().run('sc', MAN, schedule(7), { draws: 8 });
    await flush();
    mock.calls[0]!.resolve(fakeResult(7, 20));
    await flush();
    act(() => useSimulationStore.getState().cancel('sc'));
    expect(mock.cancelled()).toBe(1);
    expect(useSimulationStore.getState().runs.sc!.status).toBe('cancelled');
    mock.calls[1]!.resolve([draw(7, 1)]);
    await run;
    const st = useSimulationStore.getState().runs.sc!;
    expect(st.status).toBe('cancelled');
    expect(st.bands).toBeNull();
    expect(st.result).not.toBeNull(); // the nominal run stays on screen
  });

  it('a new run cancels the one in flight', async () => {
    void useSimulationStore.getState().run('a', MAN, schedule(7), { draws: 0 });
    await flush();
    void useSimulationStore.getState().run('b', MAN, schedule(7), { draws: 0 });
    await flush();
    expect(mock.cancelled()).toBe(1);
    expect(useSimulationStore.getState().runs.a!.status).toBe('cancelled');
    mock.calls[0]!.resolve(fakeResult(7, 1)); // late result of the cancelled run
    mock.calls[1]!.resolve(fakeResult(7, 2));
    await flush();
    expect(useSimulationStore.getState().runs.a!.result).toBeNull();
    expect(useSimulationStore.getState().runs.b!.status).toBe('done');
  });

  it('reports worker errors', async () => {
    const run = useSimulationStore.getState().run('sc', MAN, schedule(7), { draws: 0 });
    await flush();
    mock.calls[0]!.reject(new Error('glycogen < 0 at day 37'));
    await run;
    const st = useSimulationStore.getState().runs.sc!;
    expect(st.status).toBe('error');
    expect(st.error).toMatch(/day 37/);
  });

  it('persists only the inputs of the last run (results are recomputed)', async () => {
    const run = useSimulationStore.getState().run('sc', MAN, schedule(7), { draws: 0 });
    await flush();
    mock.calls[0]!.resolve(fakeResult(7, 20));
    await run;
    const raw = JSON.parse(localStorage.getItem('vitals.simulations')!);
    expect(Object.keys(raw.state)).toEqual(['lastRuns']);
    expect(raw.state.lastRuns.sc.schedule.horizonDays).toBe(7);
    expect(JSON.stringify(raw)).not.toContain('fatMass');
  });
});

describe('useSimulation', () => {
  beforeEach(() => seedClearedSafety());

  it('marks results stale when the schedule changes and restores a lost result from the saved inputs', async () => {
    const sid = useScheduleStore.getState().activeId!;
    const { result } = renderHook(() => useSimulation(sid));
    expect(result.current.status).toBe('idle');
    expect(result.current.stale).toBe(false);

    // run with exactly the hook's own inputs: take them from what the hook would hash
    const { useRunScenario } = await import('@/state/simulationStore');
    const runner = renderHook(() => useRunScenario(sid));
    act(() => runner.result.current.run());
    await flush();
    await act(async () => {
      mock.calls[0]!.resolve(fakeResult(84, 20));
      await flush();
    });
    await act(async () => {
      for (let i = 1; i < mock.calls.length; i++) mock.calls[i]!.resolve([]);
      await flush();
    });
    await waitFor(() => expect(result.current.hasResult).toBe(true));
    expect(result.current.stale).toBe(false);
    expect(result.current.warnings[0]!.id).toBe('W-F04');
    expect(result.current.events).toHaveLength(1);

    act(() => useScheduleStore.getState().editDays(sid, [3], (t) => ({ ...t, steps: 15000 })));
    expect(result.current.stale).toBe(true);
    act(() => useScheduleStore.getState().undo(sid));
    expect(result.current.stale).toBe(false);

    // lose the in-memory result (reload): the hook recomputes from the persisted inputs
    const before = mock.calls.length;
    act(() => useSimulationStore.setState({ runs: {} }));
    await waitFor(() => expect(mock.calls.length).toBe(before + 1));
    expect(mock.calls[before]!.kind).toBe('nominal');
    runner.unmount();
  });
});
