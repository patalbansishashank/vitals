import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAndroidShellForTests } from '../androidShell';
import {
  BACKGROUND_READ_EVERY_MS,
  BACKGROUND_READ_MINUTES_KEY,
  DISCONNECTED_AFTER_MS,
  installAndroidRingLink,
  type RingLinkView,
} from '../androidRingLink';
import { flush, installFakeCapacitor, removeFakeCapacitor } from './androidFake';

function fakeService(initial: RingLinkView[] = []) {
  let rings = initial;
  const subs = new Set<(r: RingLinkView[]) => void>();
  return {
    rings: () => rings,
    subscribe(cb: (r: RingLinkView[]) => void) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    set(next: RingLinkView[]) {
      rings = next;
      subs.forEach((cb) => cb(next));
    },
    subs,
  };
}

const ring = (state: string, extra: Partial<RingLinkView> = {}): RingLinkView => ({ ringKey: 'ble:jstyle2301|j-style:2301#ab12', state, ...extra });

let timers: Array<{ fn: () => void; ms: number; cleared: boolean }>;
const opts = (keep = true) => ({
  keepConnected: () => keep,
  setTimer: (fn: () => void, ms: number) => {
    const t = { fn, ms, cleared: false };
    timers.push(t);
    return t;
  },
  clearTimer: (t: unknown) => void ((t as { cleared: boolean }).cleared = true),
});
const fire = () => timers.filter((t) => !t.cleared).forEach((t) => ((t.cleared = true), t.fn()));

beforeEach(() => {
  resetAndroidShellForTests();
  timers = [];
});
afterEach(() => {
  removeFakeCapacitor();
  vi.restoreAllMocks();
});

describe('androidRingLink', () => {
  it('starts the foreground service at the first connection and follows the state in its text', async () => {
    const fake = installFakeCapacitor();
    const svc = fakeService([ring('connecting')]);
    installAndroidRingLink(svc, opts());
    await flush();
    expect(fake.plugin.keepAlive).not.toHaveBeenCalled();
    expect(fake.plugin.setPrefs).toHaveBeenCalledWith({ keepConnected: true, ringKnown: true });

    svc.set([ring('connected')]);
    svc.set([ring('syncing')]);
    svc.set([ring('searching')]);
    await flush();
    expect(fake.plugin.requestNotificationPermission).toHaveBeenCalledTimes(1);
    expect(fake.plugin.keepAlive.mock.calls.map((c) => c[0])).toEqual([
      { on: true, text: 'Ring connected' },
      { on: true, text: 'Reading your ring…' },
      { on: true, text: 'Looking for your ring…' },
    ]);
  });

  it('stops the service when the person disconnects, another device takes the ring, or keep connected is off', async () => {
    for (const next of [[ring('idle', { paused: true })], [ring('elsewhere')], []]) {
      resetAndroidShellForTests();
      const fake = installFakeCapacitor();
      const svc = fakeService([ring('connected')]);
      installAndroidRingLink(svc, opts());
      svc.set(next);
      await flush();
      expect(fake.plugin.keepAlive.mock.calls.at(-1)?.[0]).toEqual({ on: false });
    }
    resetAndroidShellForTests();
    const fake = installFakeCapacitor();
    installAndroidRingLink(fakeService([ring('connected')]), opts(false));
    await flush();
    expect(fake.plugin.keepAlive).not.toHaveBeenCalled();
    expect(fake.plugin.setPrefs).toHaveBeenCalledWith({ keepConnected: false, ringKnown: true });
  });

  it('warns about a low battery once per charge', async () => {
    const fake = installFakeCapacitor();
    const svc = fakeService([ring('connected', { battery: 40 })]);
    installAndroidRingLink(svc, opts());
    svc.set([ring('connected', { battery: 15 })]);
    svc.set([ring('connected', { battery: 12 })]);
    svc.set([ring('connected', { battery: 18 })]);
    await flush();
    expect(fake.plugin.notify).toHaveBeenCalledTimes(1);
    expect(fake.plugin.notify.mock.calls[0]?.[0]).toMatchObject({ kind: 'battery_low', title: 'Ring battery low' });

    svc.set([ring('connected', { battery: 18, charging: true })]);
    svc.set([ring('connected', { battery: 14 })]);
    await flush();
    expect(fake.plugin.clearNotice).toHaveBeenCalledWith({ kind: 'battery_low' });
    expect(fake.plugin.notify).toHaveBeenCalledTimes(2);
  });

  it('says "Ring disconnected" after 10 minutes without the ring and clears it when the ring is back', async () => {
    const fake = installFakeCapacitor();
    const svc = fakeService([ring('connected')]);
    installAndroidRingLink(svc, opts());
    svc.set([ring('searching')]);
    svc.set([ring('error')]);
    expect(timers.filter((t) => !t.cleared)).toHaveLength(1);
    expect(timers[0]?.ms).toBe(DISCONNECTED_AFTER_MS);
    fire();
    await flush();
    expect(fake.plugin.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ring_disconnected', title: 'Ring disconnected' }));

    svc.set([ring('connected')]);
    await flush();
    expect(fake.plugin.clearNotice).toHaveBeenCalledWith({ kind: 'ring_disconnected' });
  });

  it('does not warn when the ring comes back in time, or when the person pressed Disconnect', async () => {
    const fake = installFakeCapacitor();
    const svc = fakeService([ring('connected')]);
    installAndroidRingLink(svc, opts());
    svc.set([ring('searching')]);
    svc.set([ring('connected')]);
    svc.set([ring('idle', { paused: true })]);
    fire();
    await flush();
    expect(fake.plugin.notify).not.toHaveBeenCalled();
  });

  it('does not warn again when the charger contact flaps at a low level, and a second ring keeps the notice up', async () => {
    const fake = installFakeCapacitor();
    const a = (extra: Partial<RingLinkView>) => ({ ...ring('connected'), ringKey: 'a', ...extra });
    const b = (extra: Partial<RingLinkView>) => ({ ...ring('connected'), ringKey: 'b', ...extra });
    const svc = fakeService([a({ battery: 10 })]);
    installAndroidRingLink(svc, opts());
    svc.set([a({ battery: 10, charging: true })]);
    svc.set([a({ battery: 10 })]);
    svc.set([a({ battery: 10, charging: true })]);
    svc.set([a({ battery: 10 })]);
    await flush();
    expect(fake.plugin.notify).toHaveBeenCalledTimes(1);

    svc.set([a({ battery: 10 }), b({ battery: 9 })]);
    fake.plugin.clearNotice.mockClear();
    svc.set([a({ battery: 10, charging: true }), b({ battery: 9 })]);
    await flush();
    expect(fake.plugin.clearNotice).not.toHaveBeenCalled();
  });

  it('drops the notices and timers of a ring that is forgotten', async () => {
    const fake = installFakeCapacitor();
    const svc = fakeService([ring('connected', { battery: 10 })]);
    installAndroidRingLink(svc, opts());
    svc.set([ring('searching', { battery: 10 })]);
    svc.set([]);
    await flush();
    expect(timers.filter((t) => !t.cleared)).toHaveLength(0);
    expect(fake.plugin.clearNotice).toHaveBeenCalledWith({ kind: 'battery_low' });
  });

  it('does not say "Ring disconnected" once keep connected was switched off meanwhile', async () => {
    const fake = installFakeCapacitor();
    let keep = true;
    const svc = fakeService([ring('connected')]);
    installAndroidRingLink(svc, { ...opts(), keepConnected: () => keep });
    svc.set([ring('searching')]);
    keep = false;
    fire();
    await flush();
    expect(fake.plugin.notify).not.toHaveBeenCalled();
  });

  it('asks for the service again on resume when Android refused it', async () => {
    const fake = installFakeCapacitor();
    const svc = fakeService([ring('connected')]);
    installAndroidRingLink(svc, opts());
    await flush();
    expect(fake.plugin.keepAlive).toHaveBeenCalledTimes(1);
    fake.emit('resume'); // getState says the service is not running
    await flush();
    expect(fake.plugin.keepAlive).toHaveBeenCalledTimes(2);
    expect(fake.plugin.keepAlive).toHaveBeenLastCalledWith({ on: true, text: 'Ring connected' });

    fake.plugin.getState.mockResolvedValueOnce({ bluetoothOn: true, notificationsAllowed: true, keepAliveOn: true, launchReason: 'share' as const });
    fake.emit('resume');
    await flush();
    expect(fake.plugin.keepAlive).toHaveBeenCalledTimes(2);
  });

  it('stops listening and clears its timers when uninstalled', async () => {
    installFakeCapacitor();
    const svc = fakeService([ring('connected')]);
    const off = installAndroidRingLink(svc, opts());
    svc.set([ring('searching')]);
    off();
    expect(svc.subs.size).toBe(0);
    expect(timers.every((t) => t.cleared)).toBe(true);
  });

  it('does nothing without the plugin (web)', async () => {
    const svc = fakeService([ring('connected', { battery: 5 })]);
    expect(() => installAndroidRingLink(svc, opts())()).not.toThrow();
  });
});

describe('androidRingLink background read (ringTick)', () => {
  const tickOpts = (clock: { t: number }, keep = true) => ({ ...opts(keep), now: () => clock.t, sleep: async () => {} });
  const settle = async () => {
    for (let i = 0; i < 5; i++) await flush();
  };

  it('asks for a tick every 30 minutes, or what QA set in minutes', async () => {
    const fake = installFakeCapacitor();
    installAndroidRingLink(fakeService([ring('connected')]), opts());
    await flush();
    expect(fake.plugin.setRingTick).toHaveBeenCalledWith({ everyMs: BACKGROUND_READ_EVERY_MS });

    resetAndroidShellForTests();
    const fake2 = installFakeCapacitor();
    localStorage.setItem(BACKGROUND_READ_MINUTES_KEY, '5');
    try {
      installAndroidRingLink(fakeService([ring('connected')]), opts());
      await flush();
      expect(fake2.plugin.setRingTick).toHaveBeenCalledWith({ everyMs: 5 * 60_000 });
    } finally {
      localStorage.removeItem(BACKGROUND_READ_MINUTES_KEY);
    }
  });

  it('reads every ring this device keeps, then lets the phone sleep', async () => {
    const fake = installFakeCapacitor();
    const svc = Object.assign(
      fakeService([
        { ...ring('connected'), ringKey: 'a' },
        { ...ring('searching'), ringKey: 'b' },
        { ...ring('idle', { paused: true }), ringKey: 'c' },
        { ...ring('elsewhere'), ringKey: 'd' },
        { ...ring('syncing'), ringKey: 'e' },
      ]),
      { syncNow: vi.fn(async (_key: string) => {}) },
    );
    installAndroidRingLink(svc, tickOpts({ t: 0 }));
    await flush();
    fake.emit('ringTick', { at: 1 });
    await settle();
    expect(svc.syncNow.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
    expect(fake.plugin.ringTickDone).toHaveBeenCalledTimes(1);
  });

  it('lets the phone sleep when a read fails, and reads nothing when keep connected is off', async () => {
    const fake = installFakeCapacitor();
    const svc = Object.assign(fakeService([ring('connected')]), { syncNow: vi.fn(async () => Promise.reject(new Error('gone'))) });
    installAndroidRingLink(svc, tickOpts({ t: 0 }));
    fake.emit('ringTick');
    await settle();
    expect(svc.syncNow).toHaveBeenCalledTimes(1);
    expect(fake.plugin.ringTickDone).toHaveBeenCalledTimes(1);

    resetAndroidShellForTests();
    const fake2 = installFakeCapacitor();
    const svc2 = Object.assign(fakeService([ring('connected')]), { syncNow: vi.fn(async () => {}) });
    installAndroidRingLink(svc2, tickOpts({ t: 0 }, false));
    fake2.emit('ringTick');
    await settle();
    expect(svc2.syncNow).not.toHaveBeenCalled();
    expect(fake2.plugin.ringTickDone).toHaveBeenCalledTimes(1);
  });

  it('keeps all reads of a tick inside one budget, and waits for a read already running before letting the phone sleep', async () => {
    const fake = installFakeCapacitor();
    const clock = { t: 0 };
    const sleeps: number[] = [];
    const svc = Object.assign(
      fakeService([
        { ...ring('searching'), ringKey: 'a' },
        { ...ring('searching'), ringKey: 'b' },
      ]),
      // each read never ends: the timeout wins and the clock moves by what was waited
      { syncNow: vi.fn(() => new Promise<void>(() => {})) },
    );
    installAndroidRingLink(svc, { ...opts(), now: () => clock.t, sleep: async (ms: number) => { sleeps.push(ms); clock.t += ms; } });
    fake.emit('ringTick');
    for (let i = 0; i < 10; i++) await flush();
    expect(sleeps).toEqual([100_000, 40_000, 30_000]);
    expect(fake.plugin.ringTickDone).toHaveBeenCalledTimes(1);

    resetAndroidShellForTests();
    const fake2 = installFakeCapacitor();
    const sleeps2: number[] = [];
    const svc2 = Object.assign(fakeService([ring('syncing')]), { syncNow: vi.fn(async () => {}) });
    installAndroidRingLink(svc2, { ...opts(), now: () => 0, sleep: async (ms: number) => void sleeps2.push(ms) });
    fake2.emit('ringTick');
    for (let i = 0; i < 5; i++) await flush();
    expect(svc2.syncNow).not.toHaveBeenCalled();
    expect(sleeps2).toEqual([30_000]);
    expect(fake2.plugin.ringTickDone).toHaveBeenCalledTimes(1);
  });

  it('says "Ring disconnected" by the wall clock when the 10-minute timer slept through', async () => {
    const fake = installFakeCapacitor();
    const clock = { t: 1_000 };
    const svc = fakeService([ring('connected')]);
    installAndroidRingLink(svc, tickOpts(clock));
    svc.set([ring('searching')]);
    clock.t += DISCONNECTED_AFTER_MS - 1;
    fake.emit('ringTick');
    await settle();
    expect(fake.plugin.notify).not.toHaveBeenCalled();
    clock.t += 1;
    fake.emit('ringTick');
    await settle();
    expect(fake.plugin.notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ring_disconnected' }));
    // the timer that slept through does not say it a second time
    fire();
    await flush();
    expect(fake.plugin.notify).toHaveBeenCalledTimes(1);
  });
});
