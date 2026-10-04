/**
 * A fake ring service for tests and the screenshot fixtures: one scenario per state of design/screens/ring-pages.md
 * §5.8 (plus low battery, sync failed, several rings). In memory, deterministic, no Bluetooth. The scan yields two
 * J-Style 2301 candidates; pair, connect and checks move through their phases on short timers.
 */
import type { CheckMetric, CheckResult, RingCandidate, RingCaps, RingPlatform, RingService, RingSharing, RingStatus, SharingState } from './data';

export type RingScenario =
  | 'unsupported'
  | 'none'
  | 'bluetooth_off'
  | 'permission_needed'
  | 'idle'
  | 'searching'
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'elsewhere'
  | 'stale'
  | 'error'
  | 'low_battery'
  | 'sync_failed'
  | 'two_rings';

export const RING_SCENARIOS: readonly RingScenario[] = [
  'unsupported', 'none', 'bluetooth_off', 'permission_needed', 'idle', 'searching', 'connecting', 'connected', 'syncing',
  'elsewhere', 'stale', 'error', 'low_battery', 'sync_failed', 'two_rings',
];

/** The J-Style 2301 driver's capabilities (no intervals, no find, no reset; decision 13: no per-ring rows). */
export const JSTYLE_CAPS: RingCaps = { checks: ['hr', 'spo2', 'hrv', 'skin_temp'], checkSeconds: 32 };

export interface FakeRingOptions {
  /** "now" for the fixture (ms). Default: Date.now(). */
  now?: number;
  /** Milliseconds per fake step (pair stages, check progress). 0 resolves at once. */
  stepMs?: number;
}

const KEY = 'ble:jstyle2301|j-style:2301#c3d94f2a';
const KEY2 = 'ble:jstyle2301|j-style:2301#5e0a91c0';
const ago = (now: number, ms: number) => new Date(now - ms).toISOString();

export function scenarioRings(s: RingScenario, now: number): RingStatus[] {
  const base: RingStatus = { ringKey: KEY, label: 'J-Style 2301', state: 'connected', battery: 72, firmware: 'V0789', lastSyncAt: ago(now, 6 * 60_000), caps: JSTYLE_CAPS };
  switch (s) {
    case 'unsupported':
      return [{ ...base, state: 'unsupported', battery: 64, lastSyncAt: ago(now, 2 * 3_600_000), lastSyncBy: 'Pixel phone' }];
    case 'none':
      return [];
    case 'bluetooth_off':
      return [{ ...base, state: 'bluetooth_off' }];
    case 'permission_needed':
      return [{ ...base, state: 'permission_needed' }];
    case 'idle':
      return [{ ...base, state: 'idle', lastSyncAt: ago(now, 3 * 3_600_000) }];
    case 'searching':
      return [{ ...base, state: 'searching' }];
    case 'connecting':
      return [{ ...base, state: 'connecting' }];
    case 'connected':
      return [base];
    case 'syncing':
      return [{ ...base, state: 'syncing', syncProgress: 0.34 }];
    case 'elsewhere':
      return [{ ...base, state: 'elsewhere', heldBy: { deviceId: 'dev-phone', deviceLabel: 'Pixel phone', platform: 'android', since: ago(now, 4 * 3_600_000) } }];
    case 'stale':
      return [{ ...base, state: 'idle', battery: 40, lastSyncAt: ago(now, 3 * 86_400_000) }];
    case 'error':
      return [{ ...base, state: 'error', error: { code: 'not_found', message: 'Your ring may be connected to another app or phone. Close it there, then try again.' } }];
    case 'low_battery':
      return [{ ...base, battery: 12 }];
    case 'sync_failed':
      return [{ ...base, syncError: 'the ring stopped answering' }];
    case 'two_rings':
      return [base, { ...base, ringKey: KEY2, state: 'idle', battery: 55, lastSyncAt: ago(now, 26 * 3_600_000) }];
  }
}

export const FAKE_CANDIDATES: RingCandidate[] = [
  { candidateId: 'cand-1', driverId: 'jstyle2301', label: 'J-Style 2301', rssi: -58, known: false, idTail: '4F2A' },
  { candidateId: 'cand-2', driverId: 'jstyle2301', label: 'J-Style 2301', rssi: -84, known: false, idTail: '91C0' },
];

const CHECK_UNIT: Record<CheckMetric, string> = { hr: 'bpm', spo2: '%', hrv: 'ms', skin_temp: '°C' };
const CHECK_VALUE: Record<CheckMetric, number> = { hr: 71, spo2: 97, hrv: 46, skin_temp: 33.9 };

export interface FakeRingService extends RingService {
  /** Replace the rings (tests drive state changes). */
  setRings(rings: RingStatus[]): void;
  /** What the page asked for, in order ("connect:<key>", "syncNow:<key>", …). */
  calls: string[];
  /** Make the next check fail with this code ('no_reading' | 'off_finger'). */
  failNextCheck(code: 'no_reading' | 'off_finger' | null): void;
  /** Make the next pair fail. */
  failNextPair(on: boolean): void;
}

export function createFakeRingService(scenario: RingScenario, opts: FakeRingOptions = {}): FakeRingService {
  const now = opts.now ?? Date.now();
  const step = opts.stepMs ?? 0;
  let rings = scenarioRings(scenario, now);
  const subs = new Set<(r: RingStatus[]) => void>();
  const calls: string[] = [];
  let checkFail: 'no_reading' | 'off_finger' | null = null;
  let pairFail = false;
  const emit = () => subs.forEach((cb) => cb(rings));
  const patch = (key: string, p: Partial<RingStatus>) => {
    rings = rings.map((r) => (r.ringKey === key ? { ...r, ...p } : r));
    emit();
  };
  const wait = (ms = step) => (ms ? new Promise<void>((res) => setTimeout(res, ms)) : Promise.resolve());
  return {
    calls,
    setRings(r) {
      rings = r;
      emit();
    },
    failNextCheck(c) {
      checkFail = c;
    },
    failNextPair(on) {
      pairFail = on;
    },
    rings: () => rings,
    availability: () => (scenario === 'unsupported' ? 'unsupported' : scenario === 'bluetooth_off' ? 'bluetooth_off' : scenario === 'permission_needed' ? 'permission_needed' : 'ready'),
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    async *scan(signal) {
      calls.push('scan');
      for (const c of FAKE_CANDIDATES) {
        if (signal.aborted) return;
        await wait();
        yield c;
      }
    },
    async pair(candidateId) {
      calls.push(`pair:${candidateId}`);
      await wait();
      if (pairFail) {
        pairFail = false;
        throw new Error('Couldn’t connect. Keep the ring close and try again.');
      }
      const r: RingStatus = { ringKey: KEY, label: 'J-Style 2301', state: 'connected', battery: 80, firmware: 'V0789', lastSyncAt: new Date(now).toISOString(), caps: JSTYLE_CAPS };
      rings = [...rings.filter((x) => x.ringKey !== KEY), r];
      emit();
      return r;
    },
    async connectHere(key) {
      calls.push(`connectHere:${key}`);
      patch(key, { state: 'connecting', heldBy: undefined });
      await wait();
      patch(key, { state: 'connected', lastSyncAt: new Date(now).toISOString() });
    },
    async connect(key) {
      calls.push(`connect:${key}`);
      patch(key, { state: 'connecting' });
      await wait();
      patch(key, { state: 'connected' });
    },
    async stopConnecting(key) {
      calls.push(`stop:${key}`);
      patch(key, { state: 'idle' });
    },
    async syncNow(key) {
      calls.push(`syncNow:${key}`);
      patch(key, { state: 'syncing', syncProgress: 0 });
      await wait();
      patch(key, { state: 'connected', syncProgress: undefined, lastSyncAt: new Date(now).toISOString(), syncError: undefined });
    },
    async checkNow(key, metric): Promise<CheckResult> {
      calls.push(`checkNow:${key}:${metric}`);
      await wait();
      if (checkFail) {
        const c = checkFail;
        checkFail = null;
        throw Object.assign(new Error(c), { code: c });
      }
      return { value: CHECK_VALUE[metric], unit: CHECK_UNIT[metric], at: new Date(now).toISOString() };
    },
    async stopCheck(key) {
      calls.push(`stopCheck:${key}`);
    },
    async disconnect(key) {
      calls.push(`disconnect:${key}`);
      patch(key, { state: 'idle' });
    },
    async forget(key) {
      calls.push(`forget:${key}`);
      rings = rings.filter((r) => r.ringKey !== key);
      emit();
    },
    liveHeartRate(_key, cb) {
      cb(72);
      return () => {};
    },
    async requestBluetooth() {
      calls.push('requestBluetooth');
    },
    async requestPermission() {
      calls.push('requestPermission');
    },
    async openAppSettings() {
      calls.push('openAppSettings');
    },
    async batteryHistory(_key, days) {
      const out: Array<{ t: number; v: number }> = [];
      for (let h = days * 24; h >= 0; h -= 3) {
        // a gap on day 3 (no readings) and a charge on day 5
        if (h > 60 && h < 78) continue;
        const v = Math.max(8, 95 - ((days * 24 - h) % 96) * 0.9);
        out.push({ t: now - h * 3_600_000, v: Math.round(v) });
      }
      return out;
    },
  };
}

/** Platform overrides per scenario (unsupported = a browser without Web Bluetooth). */
export function scenarioPlatform(s: RingScenario): Partial<RingPlatform> {
  if (s === 'unsupported') return { platform: 'web', ble: null, installedApp: false, keepAlive: false, here: 'this browser' };
  return { platform: 'android', ble: 'capacitor', installedApp: true, keepAlive: true, here: 'this phone' };
}

/** An in-memory sharing switch. */
export function createFakeSharing(initial: SharingState = 'on', notice = false): RingSharing & { calls: boolean[] } {
  let state: SharingState = initial;
  let pending = notice;
  const subs = new Set<() => void>();
  const calls: boolean[] = [];
  return {
    calls,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    state: () => state,
    async set(on) {
      calls.push(on);
      state = on ? 'on' : 'off';
      subs.forEach((f) => f());
    },
    noticePending: () => pending,
    dismissNotice() {
      pending = false;
      subs.forEach((f) => f());
    },
  };
}
