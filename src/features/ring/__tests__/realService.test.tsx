/**
 * The Ring page against a service that has only the members of the real contract (`src/biometrics/service/types.ts`):
 * no `connect`, `stopConnecting`, `checkProgress`, `stopCheck`, `batteryHistory`, `requestBluetooth`, `caps` or `idTail`,
 * and `rings()` builds a new list (and new objects) on every call, as the real service may. Every state must still read
 * sensibly: no render loop, no key that cannot work, the live heart rate through `watchLiveHeartRate` + `liveHr`.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RingCandidate, RingService as RealRingService, RingStatus as RealRingStatus } from '@/biometrics/service/types';
import { getRingService } from '@/biometrics/service';
import { fixedClock, LivingClockContext } from '@/features/living/clock';
import { SignalsSourceProvider, type SignalsSource } from '@/features/signals/data';
import { RingServiceProvider, type RingPlatform } from '../data';
import { createFakeSharing, scenarioPlatform } from '../fixtures';
import { RingKey } from '../RingKey';
import { RingDevices } from '../RingDevices';

const TODAY = '2026-10-04';
const NOW = new Date(2026, 9, 4, 13, 41).getTime();
const clock = fixedClock(`${TODAY}T13:41`);
const KEY = 'ble:jstyle2301|j-style:2301#c3d94f2a';
const ANDROID = scenarioPlatform('connected');
const WEB: Partial<RingPlatform> = scenarioPlatform('unsupported');
const FORBIDDEN = /password|passcode|credential|\bPIN\b|MQTT|\blease\b|GATT|handshake|\bbond\b|advanced|\bcentral\b/i;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const ring = (patch: Partial<RealRingStatus> = {}): RealRingStatus => ({
  ringKey: KEY,
  label: 'J-Style 2301',
  state: 'connected',
  battery: 72,
  firmware: 'V0789',
  lastSyncAt: ago(6 * 60_000),
  ...patch,
});

const emptySource: SignalsSource = {
  subscribe: () => () => {},
  revision: () => 0,
  days: () => [],
  series: async () => [],
  baselines: async () => [],
  firstDate: () => null,
  datesWithData: () => [],
  person: () => ({ goals: {}, vendorScores: false, tempUnit: 'C' }),
  sourceInfo: () => ({ labels: [], lastReadAt: null }),
};

interface Real {
  svc: RealRingService;
  calls: string[];
  /** Replace the rings and tell the subscribers. */
  set(rings: RealRingStatus[]): void;
  watching(): number;
  watchedEver(): number;
}

/** Only the real contract; every `rings()` call builds a fresh list of fresh objects. */
function realService(initial: RealRingStatus[], availability: ReturnType<RealRingService['availability']> = 'ready', scanned: RingCandidate[] = []): Real {
  let rings = initial;
  const subs = new Set<(r: RealRingStatus[]) => void>();
  const calls: string[] = [];
  let live = 0;
  let ever = 0;
  const fresh = () => rings.map((r) => ({ ...r }));
  const svc: RealRingService = {
    async start() {},
    async stop() {
      calls.push('stop');
    },
    rings: fresh,
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    availability: () => availability,
    async *scan() {
      calls.push('scan');
      for (const c of scanned) yield c;
    },
    async pair(id) {
      calls.push(`pair:${id}`);
      const r = ring({ ringKey: 'ble:jstyle2301|j-style:2301#0a0b0c0d' });
      rings = [...rings, r];
      subs.forEach((cb) => cb(fresh()));
      return r;
    },
    async connectHere(key) {
      calls.push(`connectHere:${key}`);
    },
    async syncNow(key) {
      calls.push(`syncNow:${key}`);
    },
    async checkNow(key, metric) {
      calls.push(`checkNow:${key}:${metric}`);
      return { value: 71, unit: 'bpm', at: new Date(NOW).toISOString() };
    },
    watchLiveHeartRate(key) {
      calls.push(`watch:${key}`);
      live++;
      ever++;
      return () => {
        live--;
        calls.push(`unwatch:${key}`);
      };
    },
    async syncLink() {
      throw new Error('not used by the Ring page');
    },
    async disconnect(key) {
      calls.push(`disconnect:${key}`);
    },
    async forget(key) {
      calls.push(`forget:${key}`);
    },
  };
  return {
    svc,
    calls,
    set(next) {
      rings = next;
      subs.forEach((cb) => cb(fresh()));
    },
    watching: () => live,
    watchedEver: () => ever,
  };
}

function page(real: Real, platform: Partial<RingPlatform> = ANDROID) {
  return render(
    <MemoryRouter initialEntries={['/signals']}>
      <LivingClockContext.Provider value={clock}>
        <RingServiceProvider service={real.svc} platform={platform} sharing={createFakeSharing()}>
          <SignalsSourceProvider source={emptySource}>
            <RingDevices />
          </SignalsSourceProvider>
        </RingServiceProvider>
      </LivingClockContext.Provider>
    </MemoryRouter>,
  );
}

const card = () => document.querySelector('.rg-card') as HTMLElement;
const word = () => card().querySelector('.rg-card__word-now')?.textContent;
const buttons = (root: ParentNode = document) => Array.from(root.querySelectorAll('button')).map((b) => b.textContent);
const norm = (s: string | null | undefined) => (s ?? '').replace(/[\u2009\u00a0]/g, ' ');
const flush = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Ring page on the real service contract', () => {
  it('idle: Connect goes through connectHere', async () => {
    const real = realService([ring({ state: 'idle', lastSyncAt: ago(3 * 3_600_000) })]);
    page(real);
    expect(word()).toBe('not connected');
    fireEvent.click(within(card()).getByRole('button', { name: 'Connect' }));
    await flush();
    expect(real.calls).toContain(`connectHere:${KEY}`);
    expect(real.calls).not.toContain('stop');
  });

  it.each(['searching', 'connecting'] as const)('%s: no Stop key (the service-wide stop() must never be called from a ring card)', (state) => {
    page(realService([ring({ state })]));
    expect(word()).toBe(state === 'searching' ? 'looking for your ring…' : 'connecting…');
    expect(card().querySelector('.rg-card__keys')).toBeNull();
    expect(buttons(card())).not.toContain('Stop');
  });

  it('elsewhere: Connect here instead', async () => {
    const real = realService([ring({ state: 'elsewhere', heldBy: { deviceId: 'd', deviceLabel: 'Pixel phone', platform: 'android', since: ago(4 * 3_600_000) } })]);
    page(real);
    expect(word()).toBe('connected to Pixel phone');
    fireEvent.click(screen.getByRole('button', { name: 'Connect here instead' }));
    await flush();
    expect(real.calls).toContain(`connectHere:${KEY}`);
    // no Check now while another device holds the ring
    expect(screen.queryByRole('heading', { name: 'Check now' })).toBeNull();
  });

  it('error: the service’s message, Try again (connectHere) and Forget…', async () => {
    const real = realService([ring({ state: 'error', error: { code: 'not_found', message: 'Your ring may be connected to another app or phone. Close it there, then try again.' } })]);
    page(real);
    expect(word()).toBe('couldn’t connect');
    expect(card().textContent).toContain('Your ring may be connected to another app or phone.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush();
    expect(real.calls).toContain(`connectHere:${KEY}`);
    expect(screen.getByRole('button', { name: 'Forget…' })).toBeTruthy();
  });

  it('Bluetooth off and no permission: the words, and no key the service cannot serve', () => {
    const off = page(realService([ring({ state: 'bluetooth_off' })], 'bluetooth_off'));
    expect(word()).toBe('Bluetooth is off');
    expect(card().textContent).toContain('Turn on Bluetooth to reach your ring.');
    expect(card().querySelector('.rg-card__keys')).toBeNull();
    off.unmount();
    page(realService([ring({ state: 'permission_needed' })], 'permission_needed'));
    expect(word()).toBe('needs permission');
    expect(card().textContent).toContain('Vitals needs the Nearby devices permission to find your ring.');
    expect(card().querySelector('.rg-card__keys')).toBeNull();
  });

  it('connected: no render loop on a service that builds a new list per call', async () => {
    const real = realService([ring()]);
    page(real);
    await flush();
    expect(word()).toBe('connected');
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Check now' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => r.textContent)).toEqual(['heart rate']);
    // a change from the service arrives once and the page follows
    act(() => real.set([ring({ battery: 40 })]));
    expect(norm(card().textContent)).toContain('40 %');
    expect(document.body.textContent ?? '').not.toMatch(FORBIDDEN);
  });

  it('Check now: no Stop key, the result is shown', async () => {
    const real = realService([ring()]);
    page(real);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    await flush();
    expect(real.calls).toContain(`checkNow:${KEY}:hr`);
    expect(norm(document.querySelector('.rs-readout')?.textContent)).toBe('71 bpm');
    expect(screen.getByRole('button', { name: 'Start' })).toBeTruthy();
  });

  it('no ring: availability says which first card shows', async () => {
    page(realService([], 'ready'));
    expect(screen.getByRole('button', { name: 'Look for rings' })).toBeTruthy();
    cleanup();

    page(realService([], 'bluetooth_off'));
    expect(screen.getByRole('heading', { name: 'Connect your ring' })).toBeTruthy();
    expect(document.body.textContent).toContain('Turn on Bluetooth to reach your ring.');
    // Android without a way to ask for Bluetooth: no key at all rather than one that does nothing
    expect(screen.queryByRole('button', { name: 'Look for rings' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn on Bluetooth' })).toBeNull();
    cleanup();

    page(realService([], 'permission_needed'));
    expect(document.body.textContent).toContain('Vitals needs the Nearby devices permission to find your ring.');
    expect(screen.queryByRole('button', { name: 'Look for rings' })).toBeNull();
    cleanup();

    page(realService([], 'unsupported'), WEB);
    expect(word()).toBe('can’t connect here');
    expect(screen.getByRole('link', { name: 'Get the app' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Import a file' })).toBeTruthy();
    // nothing read from anywhere: no "from your ring" faceplate on a page with no ring
    expect(screen.queryByRole('heading', { name: 'Today from your ring' })).toBeNull();
  });

  it('pairing: candidates without an id tail list by label; a double tap pairs once; the ring joins the page', async () => {
    const real = realService([], 'ready', [{ candidateId: 'c1', driverId: 'jstyle2301', label: 'J-Style 2301', rssi: -60, known: false }]);
    page(real);
    fireEvent.click(screen.getByRole('button', { name: 'Look for rings' }));
    await flush();
    const row = screen.getByRole('button', { name: /J-Style 2301/ });
    expect(row.textContent).not.toContain('ending');
    act(() => {
      fireEvent.click(row);
      fireEvent.click(row);
    });
    await flush();
    expect(real.calls.filter((c) => c.startsWith('pair:'))).toEqual(['pair:c1']);
    expect(document.body.textContent).toContain('Connected.');
    expect(document.body.textContent ?? '').not.toMatch(FORBIDDEN);
  });

  it('the app’s placeholder service (no Bluetooth, no rings) renders the "can’t connect here" card and settles', async () => {
    render(
      <MemoryRouter initialEntries={['/signals']}>
        <LivingClockContext.Provider value={clock}>
          <SignalsSourceProvider source={emptySource}>
            <RingDevices />
          </SignalsSourceProvider>
        </LivingClockContext.Provider>
      </MemoryRouter>,
    );
    await flush();
    expect(getRingService().availability()).toBe('unsupported');
    expect(word()).toBe('can’t connect here');
    expect(screen.queryByRole('link', { name: 'Ring settings' })).toBeNull();
  });
});

describe('RingKey on the real service contract', () => {
  const key = (real: Real, platform: Partial<RingPlatform> = ANDROID) =>
    render(
      <MemoryRouter initialEntries={['/today']}>
        <RingServiceProvider service={real.svc} platform={platform}>
          <RingKey />
        </RingServiceProvider>
      </MemoryRouter>,
    );

  it('names the worst state and follows changes without looping', () => {
    const real = realService([ring()]);
    key(real);
    expect(screen.getByRole('link', { name: 'Body signals · ring connected' })).toBeTruthy();
    act(() => real.set([ring({ state: 'error', error: { code: 'failed', message: 'x' } })]));
    expect(screen.getByRole('link', { name: 'Body signals · ring needs attention' })).toBeTruthy();
    act(() => real.set([ring({ state: 'syncing', syncProgress: 0.3 })]));
    expect(screen.getByRole('link', { name: 'Body signals · reading your ring' })).toBeTruthy();
  });

  it('shows nothing on the web with no ring and no Bluetooth; a plain "Body signals" with no ring in the apps', () => {
    key(realService([], 'unsupported'), WEB);
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    key(realService([], 'ready'));
    expect(screen.getByRole('link', { name: 'Body signals' })).toBeTruthy();
  });
});
