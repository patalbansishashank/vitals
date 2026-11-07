/** The `VitalsGauge` plugin glue: feature detection, the 1.5 s probe, and a local timeout that adopts or falls back. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { probeGaugeLocal, resetGaugeLocalForTests, runLocalWorkout, vitalsGauge, type LocalWorkoutAnswer, type VitalsGaugePlugin } from '../gaugeLocal';

function install(plugin: Partial<VitalsGaugePlugin> | null, o: { platform?: string; available?: boolean } = {}) {
  const cap = {
    getPlatform: () => o.platform ?? 'android',
    isNativePlatform: () => true,
    registerPlugin: vi.fn(() => plugin),
    ...(o.available !== undefined ? { isPluginAvailable: (n: string) => n === 'VitalsGauge' && o.available! } : {}),
  };
  (globalThis as { Capacitor?: unknown }).Capacitor = cap;
  return cap;
}

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  resetGaugeLocalForTests();
  vi.useRealTimers();
});

const never = <T>() => new Promise<T>(() => undefined);

describe('gaugeLocal', () => {
  it('finds the plugin only in the Android app, and not on an older shell', () => {
    expect(vitalsGauge()).toBeNull();
    install({}, { platform: 'web' });
    expect(vitalsGauge()).toBeNull();
    install({}, { available: false });
    expect(vitalsGauge()).toBeNull();
    install({ info: vi.fn() }, { available: true });
    expect(vitalsGauge()).not.toBeNull();
  });

  it('uses the local path only with a Gauge installed, the permission granted and a status answer in time', async () => {
    const answer: LocalWorkoutAnswer = { status: 'done', result: { state: 'idle' } };
    install({ info: async () => ({ package: 'com.pulseloop', installed: ['com.pulseloop'], granted: true }), workout: async () => answer });
    expect(await probeGaugeLocal()).toBe(true);
    resetGaugeLocalForTests();
    install({ info: async () => ({ package: 'com.pulseloop', installed: ['com.pulseloop'], granted: false }), workout: async () => answer });
    expect(await probeGaugeLocal()).toBe(false);
    resetGaugeLocalForTests();
    install({ info: async () => ({ package: null, installed: [], granted: false }), workout: async () => answer });
    expect(await probeGaugeLocal()).toBe(false);
    resetGaugeLocalForTests();
    // an older shell: the proxy's calls reject
    install({ info: () => Promise.reject(new Error('not implemented')), workout: () => Promise.reject(new Error('not implemented')) });
    expect(await probeGaugeLocal()).toBe(false);
    resetGaugeLocalForTests();
    vi.useFakeTimers();
    install({ info: async () => ({ package: 'com.pulseloop', installed: ['com.pulseloop'], granted: true }), workout: () => never() });
    const p = probeGaugeLocal();
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBe(false);
  });

  it('passes the plugin’s ack through', async () => {
    const workout = vi.fn(async (): Promise<LocalWorkoutAnswer> => ({ status: 'done', result: { state: 'recording', sessionId: 'w-1', type: 'run', startedAt: '2026-10-27T04:00:00.000Z' } }));
    install({ workout });
    const r = await runLocalWorkout('workout.start', { type: 'run', useGps: false });
    expect(r).toEqual({ kind: 'ack', status: 'done', result: { state: 'recording', sessionId: 'w-1', type: 'run', startedAt: '2026-10-27T04:00:00.000Z' } });
    expect(workout).toHaveBeenCalledWith({ command: 'workout.start', type: 'run', useGps: false, timeoutMs: 5000 });
  });

  it('after a timeout asks the status once: adopts the asked state, else falls back', async () => {
    const reached = vi.fn(async (o: { command: string }): Promise<LocalWorkoutAnswer> => (o.command === 'workout.status' ? { status: 'done', result: { state: 'paused', sessionId: 'w-1' } } : { status: 'timeout' }));
    install({ workout: reached });
    expect(await runLocalWorkout('workout.pause', {})).toEqual({ kind: 'ack', status: 'done', code: 'adopted', result: { state: 'paused', sessionId: 'w-1' } });
    expect(reached).toHaveBeenCalledTimes(2);

    resetGaugeLocalForTests();
    const notReached = vi.fn(async (o: { command: string }): Promise<LocalWorkoutAnswer> => (o.command === 'workout.status' ? { status: 'done', result: { state: 'recording' } } : { status: 'timeout' }));
    install({ workout: notReached });
    expect(await runLocalWorkout('workout.stop', {})).toEqual({ kind: 'fallback' });

    resetGaugeLocalForTests();
    vi.useFakeTimers();
    install({ workout: () => never() });
    const p = runLocalWorkout('workout.stop', {}, { timeoutMs: 100, probeMs: 100 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toEqual({ kind: 'fallback' });
  });
});
