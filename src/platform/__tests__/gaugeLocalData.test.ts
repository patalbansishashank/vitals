/** (r069 sync) Gauge's local snapshot through the `VitalsGauge` plugin: checked field by field, absent on older shells. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushGaugeLocal, localSnapshotOf, readGaugeLocal, resetGaugeLocalForTests } from '../gaugeLocal';

const SNAPSHOT = {
  schema: 1,
  at: '2026-10-29T11:50:00.000Z',
  app: '2.8.7-debug',
  upload: { paired: true, pending: 37, lastSentAt: '2026-10-29T11:20:00.000Z', lastError: 'timeout', lastErrorAt: '2026-10-29T11:40:00.000Z', retryAt: null, needsRepair: false },
  today: { date: '2026-10-29', ringSteps: 6120, ringStepsAt: '2026-10-29T11:48:00.000Z' },
};

function install(local: ((o: { method: string }) => Promise<unknown>) | undefined) {
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    getPlatform: () => 'android',
    isNativePlatform: () => true,
    registerPlugin: () => ({ info: vi.fn(), ...(local ? { local } : {}) }),
  };
}

afterEach(() => {
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
  resetGaugeLocalForTests();
  vi.useRealTimers();
});

describe('Gauge on this phone (r069 sync)', () => {
  it('reads a schema-1 snapshot and drops what is not one', () => {
    expect(localSnapshotOf(JSON.stringify(SNAPSHOT))).toEqual(SNAPSHOT);
    expect(localSnapshotOf(JSON.stringify({ ...SNAPSHOT, schema: 2 }))).toBeNull();
    expect(localSnapshotOf('not json')).toBeNull();
    expect(localSnapshotOf(null)).toBeNull();
    const odd = localSnapshotOf(JSON.stringify({ ...SNAPSHOT, upload: { pending: -3, lastSentAt: 'yesterday' }, today: { date: '29/10', ringSteps: 5 } }));
    expect(odd?.upload).toEqual({ paired: false, pending: 0, lastSentAt: null, lastError: null, lastErrorAt: null, retryAt: null, needsRepair: false });
    expect(odd?.today).toBeNull();
  });

  it('asks the plugin for a snapshot or a flush; null outside the app, on an older shell, on a refusal or a slow answer', async () => {
    expect(await readGaugeLocal()).toBeNull();
    const local = vi.fn(async () => ({ json: JSON.stringify(SNAPSHOT) }));
    install(local);
    expect(await readGaugeLocal()).toEqual(SNAPSHOT);
    expect(await flushGaugeLocal()).toEqual(SNAPSHOT);
    expect(local.mock.calls.map((c) => (c as unknown as [{ method: string }])[0].method)).toEqual(['snapshot', 'flush']);
    resetGaugeLocalForTests();
    install(async () => ({ error: 'gauge_refused' }));
    expect(await readGaugeLocal()).toBeNull();
    resetGaugeLocalForTests();
    install(() => Promise.reject(new Error('not implemented')));
    expect(await readGaugeLocal()).toBeNull();
    resetGaugeLocalForTests();
    vi.useFakeTimers();
    install(() => new Promise(() => undefined));
    const slow = readGaugeLocal();
    await vi.advanceTimersByTimeAsync(2500);
    expect(await slow).toBeNull();
  });
});
