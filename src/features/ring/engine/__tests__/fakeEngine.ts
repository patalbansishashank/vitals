/* A stand-in for the native `GaugeEngine` plugin: a mutable state, every call a spy, `emit` pushes a `state` event. */
import { vi } from 'vitest';
import type { EngineState, GaugeEnginePlugin } from '@/platform/gaugeEngine';

export const baseState = (over: Partial<EngineState> = {}): EngineState => ({
  mode: 'active',
  gauge: { installed: false, pendingUploads: null },
  ring: {
    state: 'connected',
    name: 'Ring 7C41',
    address: 'AA:BB:CC:DD:EE:01',
    battery: 64,
    lastSyncAt: '2026-10-30T09:30:00.000Z',
  },
  permissions: {
    bluetooth: 'granted',
    healthConnect: 'granted',
    activityRecognition: 'granted',
    notifications: 'granted',
    shortVideoAccessibility: true,
    batteryUnrestricted: true,
  },
  upload: { paired: true, pending: 3, lastSentAt: '2026-10-30T09:31:00.000Z' },
  shortVideo: { enabled: true, dailyLimit: 30, today: { instagram: 7, youtube: 4 } },
  ...over,
});

export function fakeEngine(initial: EngineState = baseState()) {
  let state = initial;
  const listeners = new Set<(s: EngineState) => void>();
  const set = (next: EngineState) => {
    state = next;
    listeners.forEach((l) => l(state));
  };
  const plugin = {
    getState: vi.fn(async () => state),
    addListener: vi.fn(async (_e: 'state', cb: (s: EngineState) => void) => {
      listeners.add(cb);
      return { remove: vi.fn(async () => void listeners.delete(cb)) };
    }),
    configure: vi.fn<GaugeEnginePlugin['configure']>(async () => undefined),
    uninstallGauge: vi.fn(async () => undefined),
    takeOver: vi.fn(async () => state),
    requestPermissions: vi.fn(async () => state),
    openAccessibilitySettings: vi.fn(async () => undefined),
    openAppInfo: vi.fn(async () => undefined),
    openBatterySettings: vi.fn(async () => undefined),
    scanRings: vi.fn(async () => ({
      devices: [
        { name: 'Ring 7C41', address: 'AA:BB:CC:DD:EE:01', rssi: -52 },
        { name: 'Ring 91F0', address: 'AA:BB:CC:DD:EE:02', rssi: -78 },
      ],
    })),
    connectRing: vi.fn(async () => state),
    forgetRing: vi.fn(async () => state),
    syncNow: vi.fn(async () => state),
    measure: vi.fn(async () => ({ started: true })),
    setShortVideoLimit: vi.fn(async () => state),
  } satisfies GaugeEnginePlugin;
  return { plugin, set, get: () => state, listenerCount: () => listeners.size };
}
