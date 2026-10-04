import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAndroidShellForTests } from '../androidShell';
import { DISCONNECTED_AFTER_MS, installAndroidRingLink, type RingLinkView } from '../androidRingLink';
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
